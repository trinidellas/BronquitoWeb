"""
Migraciones de las tablas de entrenamientos (ver app/models/entrenamiento.py).
Corren al arrancar, ANTES de `create_all`.

1. Tabla original (presion_max, duty_cycle, ... y `entrenamientos_graficar`):
   sólo podía tener datos inventados del seed, porque no había ningún
   endpoint para cargar entrenamientos. Se borra; app/seed_entrenamientos.py
   vuelve a cargar los de ejemplo. También se borran las notas de los
   gráficos de evolución de entrenamientos, que apuntaban a esas sesiones.

2. Tabla con todo el JSON en una columna `datos` (primera versión del
   formato del equipo): la tabla se renombra a `entrenamientos_respaldo_v1`
   y, después de `create_all`, `reingresar` vuelve a cargar cada sesión
   repartiendo el JSON en las tablas planas. Recién si todas entraron bien
   se borra el respaldo (si algo falla, queda y se reintenta al próximo
   arranque). Cada sesión conserva su id, así las notas de la evolución
   siguen apuntando a la misma sesión.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session


RESPALDO = "entrenamientos_respaldo_v1"


@dataclass
class ResultadoMigracion:
    # Se borró la tabla original: hay que volver a cargar los ejemplos.
    borrada_original: bool = False
    # Hay sesiones en el respaldo para volver a cargar.
    hay_respaldo: bool = False


def migrar_entrenamientos(engine: Engine) -> ResultadoMigracion:
    resultado = ResultadoMigracion()
    inspector = inspect(engine)
    tablas = inspector.get_table_names()
    resultado.hay_respaldo = RESPALDO in tablas
    if "entrenamientos" not in tablas:
        return resultado
    columnas = {columna["name"] for columna in inspector.get_columns("entrenamientos")}

    if "resistencia_programada" in columnas:
        with engine.begin() as conexion:
            conexion.execute(text("DROP TABLE IF EXISTS entrenamientos_graficar"))
            conexion.execute(text("DROP TABLE entrenamientos"))
            if "anotaciones" in inspector.get_table_names():
                conexion.execute(text("DELETE FROM anotaciones WHERE grafico LIKE 'evolucion/entrenamientos/%'"))
        resultado.borrada_original = True

    elif "datos" in columnas and not resultado.hay_respaldo:
        # MySQL renombra solo las claves foráneas automáticas (entrenamientos_ibfk_N),
        # así `create_all` puede crear la tabla nueva con los mismos nombres.
        with engine.begin() as conexion:
            conexion.execute(text(f"RENAME TABLE entrenamientos TO {RESPALDO}"))
        resultado.hay_respaldo = True

    return resultado


def reingresar(db: Session) -> None:
    """Vuelve a cargar las sesiones del respaldo, con su id, y después lo borra."""
    import json

    from app.core.entrenamientos_dispositivo import guardar_entrenamiento
    from app.models.paciente import Paciente

    filas = db.execute(text(
        f"SELECT id_entrenamiento, id_paciente, archivo, datos, recibido_en FROM {RESPALDO}"
    )).mappings().all()
    for fila in filas:
        paciente = db.get(Paciente, fila["id_paciente"])
        datos = fila["datos"]
        if isinstance(datos, (str, bytes)):
            datos = json.loads(datos)
        if paciente is None or not isinstance(datos, dict):
            continue
        recibido = fila["recibido_en"] if isinstance(fila["recibido_en"], datetime) else None
        guardar_entrenamiento(db, paciente, fila["archivo"], datos,
                              id_entrenamiento=fila["id_entrenamiento"], recibido_en=recibido)
    db.commit()
    db.execute(text(f"DROP TABLE {RESPALDO}"))
    db.commit()
