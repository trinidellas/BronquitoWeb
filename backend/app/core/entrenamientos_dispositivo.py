"""
Sesiones de entrenamiento que sube el equipo. Dos pedidos por sesión, que
pueden llegar en cualquier orden y repetidos:

  - POST /dispositivo/entrenamientos       -> el JSON de la sesión.
  - POST /dispositivo/entrenamientos/csv   -> la señal (puede no haber).

Los dos se guardan por paciente + `archivo` (el nombre en la SD): si llega
de nuevo, se reemplaza y no se duplica.

El JSON se reparte en tablas planas (ver app/models/entrenamiento.py): la
sesión con sus promedios y métricas multiciclo en `entrenamientos`, cada
ciclo en `ciclos_entrenamiento`, y el JSON original entero en
`entrenamientos_json` como respaldo. Los nombres de las columnas salen de
los del JSON (ver los mapeos de abajo).

Convenciones:
  - `caida_pim_pct` se guarda con el criterio nuevo (> 0 = la PIM cayó). Los
    JSON viejos (sin "id_entrenamiento") la traen al revés: se invierte.
  - PIM positiva y PEM negativa, como las manda el equipo. La web aplica la
    convención clínica al mostrarlas.
  - Cualquier número que no venga o no sea número queda en NULL.
"""

import math
import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.dispositivo import ahora_utc
from app.models.entrenamiento import CicloEntrenamiento, Entrenamiento, EntrenamientoCsv, EntrenamientoJson
from app.models.paciente import Paciente

ESTADOS = ("completa", "incompleta", "interrumpida")
FINES = ("objetivo", "detenida", "sin_respiracion", "tiempo_maximo")
MODOS = ("automatico", "manual")

# Tope del CSV que se acepta (una sesión larga pesa cientos de KB).
MAX_CSV_BYTES = 8 * 1024 * 1024

_FECHA_EN_NOMBRE = re.compile(r"ent_(\d{8})_(\d{6})")

# --- Mapeos JSON del equipo <-> columnas -------------------------------------------
# (clave en el JSON, columna, es entero). La API le devuelve a la web las
# mismas claves del JSON, así el formato que conoce la web no cambia.

PROMEDIOS = [
    ("ti_s", "ti_prom_s", False),
    ("te_s", "te_prom_s", False),
    ("pausa_s", "pausa_prom_s", False),
    ("ti_ttot", "ti_ttot_prom", False),
    ("pif_Lmin", "pif_prom_lmin", False),
    ("pef_Lmin", "pef_prom_lmin", False),
    ("vol_insp_L", "vol_insp_prom_l", False),
    ("vol_esp_L", "vol_esp_prom_l", False),
    ("pim_cmH2O", "pim_prom_cmh2o", False),
    ("pem_cmH2O", "pem_prom_cmh2o", False),
    ("trabajo_insp_J", "trabajo_insp_prom_j", False),
    ("potencia_insp_W", "potencia_insp_prom_w", False),
]

MULTICICLO = [
    ("n_ciclos_completos", "n_ciclos_completos", True),
    ("n_fases_sueltas", "n_fases_sueltas", True),
    ("periodo_medio_s", "periodo_medio_s", False),
    ("frecuencia_rpm", "frecuencia_rpm", False),
    ("ventilacion_minuto_Lmin", "ventilacion_minuto_lmin", False),
    ("trabajo_total_insp_J", "trabajo_total_insp_j", False),
    ("pendiente_pim_por_ciclo", "pendiente_pim_por_ciclo", False),
    ("caida_pim_pct", "caida_pim_pct", False),
    ("pif_max_Lmin", "pif_max_lmin", False),
    ("pif_max_ciclo", "pif_max_ciclo", True),
    ("pef_max_Lmin", "pef_max_lmin", False),
    ("pef_max_ciclo", "pef_max_ciclo", True),
    ("pim_max_cmH2O", "pim_max_cmh2o", False),
    ("pim_max_ciclo", "pim_max_ciclo", True),
    ("pem_max_cmH2O", "pem_max_cmh2o", False),
    ("pem_max_ciclo", "pem_max_ciclo", True),
]

CICLO = [
    ("numero", "numero", True),
    ("t_inicio_s", "t_inicio_s", False),
    ("t_fin_s", "t_fin_s", False),
    ("ti_s", "ti_s", False),
    ("te_s", "te_s", False),
    ("pausa_s", "pausa_s", False),
    ("ti_ttot", "ti_ttot", False),
    ("pif_Lmin", "pif_lmin", False),
    ("pef_Lmin", "pef_lmin", False),
    ("vol_insp_L", "vol_insp_l", False),
    ("vol_esp_L", "vol_esp_l", False),
    ("pim_cmH2O", "pim_cmh2o", False),
    ("pem_cmH2O", "pem_cmh2o", False),
    ("trabajo_insp_J", "trabajo_insp_j", False),
    ("potencia_insp_W", "potencia_insp_w", False),
    ("t_pif_s", "t_pif_s", False),
    ("t_pef_s", "t_pef_s", False),
    ("t_pim_s", "t_pim_s", False),
    ("t_pem_s", "t_pem_s", False),
]


# --- Lectura defensiva del JSON ---------------------------------------------------


def _numero(valor) -> float | None:
    """Número del JSON, o None si viene null, como texto o no es finito."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if math.isfinite(valor) else None


def _entero(valor) -> int | None:
    numero = _numero(valor)
    return int(numero) if numero is not None and numero == int(numero) else None


def _opcion(valor, opciones: tuple[str, ...]) -> str | None:
    return valor if isinstance(valor, str) and valor in opciones else None


def _objeto(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _copiar(origen: dict, destino, mapeo: list[tuple[str, str, bool]]) -> None:
    """Pasa los valores de un objeto del JSON a las columnas de `destino`."""
    for clave, columna, entero in mapeo:
        setattr(destino, columna, (_entero if entero else _numero)(origen.get(clave)))


def _leer(origen, mapeo: list[tuple[str, str, bool]]) -> dict:
    """Las columnas de `origen` con las claves del JSON (para la web)."""
    return {clave: getattr(origen, columna) for clave, columna, _ in mapeo}


def es_formato_anterior(datos: dict) -> bool:
    return "id_entrenamiento" not in datos


def _fecha(datos: dict, archivo: str) -> datetime | None:
    """`fecha_hora` del JSON; si falta, la del nombre (`ent_AAAAMMDD_HHMMSS`)."""
    texto = datos.get("fecha_hora")
    if isinstance(texto, str):
        try:
            return datetime.strptime(texto[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass
    for nombre in (datos.get("id_entrenamiento"), archivo):
        coincidencia = _FECHA_EN_NOMBRE.search(nombre if isinstance(nombre, str) else "")
        if coincidencia:
            try:
                return datetime.strptime(coincidencia.group(1) + coincidencia.group(2), "%Y%m%d%H%M%S")
            except ValueError:
                pass
    return None


# --- Guardado ---------------------------------------------------------------------


def guardar_entrenamiento(
    db: Session, paciente: Paciente, archivo: str, datos: dict,
    id_entrenamiento: int | None = None, recibido_en: datetime | None = None,
) -> dict:
    """
    Guarda (o reemplaza) la sesión `archivo` del paciente. Devuelve lo que se
    le contesta al equipo: estado "nuevo" o "reemplazado", el id en la web y
    si ya llegó la señal. `id_entrenamiento` y `recibido_en` sólo los usa la
    migración, para no cambiarle el id a las sesiones que ya estaban.
    """
    entrenamiento = (
        db.query(Entrenamiento)
        .filter(Entrenamiento.id_paciente == paciente.id_paciente, Entrenamiento.archivo == archivo)
        .first()
    )
    estado = "reemplazado" if entrenamiento else "nuevo"
    if entrenamiento is None:
        entrenamiento = Entrenamiento(id_paciente=paciente.id_paciente, archivo=archivo)
        if id_entrenamiento is not None:
            entrenamiento.id_entrenamiento = id_entrenamiento
        db.add(entrenamiento)

    resumen = _objeto(datos.get("resumen"))
    ciclos = datos.get("ciclos")

    entrenamiento.recibido_en = recibido_en or ahora_utc()
    entrenamiento.version = _entero(datos.get("version"))
    entrenamiento.formato_anterior = es_formato_anterior(datos)
    entrenamiento.fecha_hora = _fecha(datos, archivo)
    entrenamiento.duracion_s = _numero(datos.get("duracion_s"))
    entrenamiento.estado = _opcion(datos.get("estado"), ESTADOS)
    entrenamiento.fin = _opcion(datos.get("fin"), FINES)
    entrenamiento.ciclos_objetivo = _entero(datos.get("ciclos_objetivo"))
    entrenamiento.nivel_resistencia = _entero(datos.get("nivel_resistencia"))
    entrenamiento.modo_resistencia = _opcion(datos.get("modo_resistencia"), MODOS)
    entrenamiento.dc_pct = _numero(datos.get("dc"))
    entrenamiento.analizada = isinstance(ciclos, list) or bool(resumen)
    entrenamiento.temperatura_c = _numero(datos.get("temperatura_c"))
    entrenamiento.humedad_rel_pct = _numero(datos.get("humedad_rel_pct"))
    entrenamiento.factor_btps = _numero(datos.get("factor_btps"))

    _copiar(_objeto(resumen.get("promedios")), entrenamiento, PROMEDIOS)
    _copiar(_objeto(resumen.get("multiciclo")), entrenamiento, MULTICICLO)
    if entrenamiento.formato_anterior and entrenamiento.caida_pim_pct is not None:
        entrenamiento.caida_pim_pct = -entrenamiento.caida_pim_pct

    nuevos = []
    for orden, ciclo in enumerate(ciclos if isinstance(ciclos, list) else []):
        if isinstance(ciclo, dict):
            fila = CicloEntrenamiento(orden=orden)
            _copiar(ciclo, fila, CICLO)
            nuevos.append(fila)
    entrenamiento.ciclos = nuevos

    if entrenamiento.original is None:
        entrenamiento.original = EntrenamientoJson(json=datos)
    else:
        entrenamiento.original.json = datos
    db.flush()

    return {
        "estado": estado,
        "id_entrenamiento": entrenamiento.id_entrenamiento,
        "senal_recibida": _csv_de(db, paciente.id_paciente, archivo) is not None,
    }


def _celda(valor: str) -> float | None:
    """Un número del CSV, o None si la celda está vacía o no es un número finito."""
    try:
        numero = float(valor)
    except ValueError:
        return None
    return numero if math.isfinite(numero) else None


COLUMNAS_CONOCIDAS = ("tiempo_ms", "tiempo_s", "presion_cmh2o", "flujo_lmin", "flujo_proc_lmin", "v_flujo_v", "v_pim_v")


def _nombre_columna(texto: str) -> str:
    """
    El nombre de una columna del encabezado, en minúsculas. Tolera un
    encabezado cortado por el firmware (ej. "flujo_proc_lmi" seguido de un
    byte nulo): lo que viene después de un \\0 se descarta, y un nombre que es
    el comienzo de uno conocido (de al menos 8 letras) se toma como ese.
    """
    nombre = texto.split("\x00", 1)[0].strip().lower()
    if nombre in COLUMNAS_CONOCIDAS or len(nombre) < 8:
        return nombre
    candidatos = [c for c in COLUMNAS_CONOCIDAS if c.startswith(nombre)]
    return candidatos[0] if len(candidatos) == 1 else nombre


def leer_senal(csv: str | None) -> dict | None:
    """
    Del CSV se devuelven tiempo (s), presión, flujo crudo y flujo procesado,
    sin tocar signos. Las columnas se buscan por nombre en el encabezado, sin
    importar mayúsculas (sin encabezado se asume `tiempo_ms,presion_cmh2o,flujo_lmin`).
    Acepta también el formato de los equipos más viejos, con el tiempo en
    segundos: `tiempo_s,v_flujo_V,v_pim_V,flujo_Lmin,presion_cmH2O`.

    - Una fila sin tiempo o sin presión se saltea.
    - Una celda vacía de flujo queda en None: es un hueco, no un 0.
    - `flujo_proc_lmin` es None si la columna no está (equipos viejos) o si
      viene vacía en todas las filas (sesiones sin análisis).
    None si no hay ninguna muestra.
    """
    indice = {"tiempo_ms": 0, "presion_cmh2o": 1, "flujo_lmin": 2}
    columna_tiempo, a_segundos = "tiempo_ms", 1000.0
    tiempo, presion, flujo, flujo_proc = [], [], [], []
    for linea in (csv or "").splitlines():
        partes = [parte.strip() for parte in linea.split(",")]
        if len(partes) < 2:
            continue
        nombres = [_nombre_columna(parte) for parte in partes]
        if "tiempo_ms" in nombres or "tiempo_s" in nombres:  # encabezado
            indice = {nombre: i for i, nombre in enumerate(nombres)}
            columna_tiempo, a_segundos = ("tiempo_ms", 1000.0) if "tiempo_ms" in nombres else ("tiempo_s", 1.0)
            continue

        def valor(columna: str) -> float | None:
            i = indice.get(columna)
            return _celda(partes[i]) if i is not None and i < len(partes) else None

        t, p = valor(columna_tiempo), valor("presion_cmh2o")
        if t is None or p is None:
            continue
        tiempo.append(round(t / a_segundos, 3))
        presion.append(round(p, 2))
        q = valor("flujo_lmin")
        flujo.append(round(q, 2) if q is not None else None)
        qp = valor("flujo_proc_lmin")
        flujo_proc.append(round(qp, 1) if qp is not None else None)
    if not tiempo:
        return None
    return {
        "tiempo_s": tiempo,
        "presion_cmh2o": presion,
        "flujo_lmin": flujo,
        "flujo_proc_lmin": flujo_proc if any(v is not None for v in flujo_proc) else None,
    }


def guardar_csv(db: Session, paciente: Paciente, archivo: str, csv: str) -> dict:
    """
    Guarda (o reemplaza) la señal de la sesión `archivo`. Puede llegar antes
    que el JSON: queda guardada y se asocia sola por el nombre.
    """
    fila = _csv_de(db, paciente.id_paciente, archivo)
    estado = "reemplazado" if fila else "nuevo"
    if fila is None:
        fila = EntrenamientoCsv(id_paciente=paciente.id_paciente, archivo=archivo)
        db.add(fila)
    fila.csv = csv
    fila.recibido_en = ahora_utc()
    db.flush()

    entrenamiento = (
        db.query(Entrenamiento.id_entrenamiento)
        .filter(Entrenamiento.id_paciente == paciente.id_paciente, Entrenamiento.archivo == archivo)
        .first()
    )
    return {
        "estado": estado,
        "id_entrenamiento": entrenamiento.id_entrenamiento if entrenamiento else None,
        "entrenamiento_recibido": entrenamiento is not None,
    }


def _csv_de(db: Session, id_paciente: int, archivo: str) -> EntrenamientoCsv | None:
    return (
        db.query(EntrenamientoCsv)
        .filter(EntrenamientoCsv.id_paciente == id_paciente, EntrenamientoCsv.archivo == archivo)
        .first()
    )


def senal_de(db: Session, entrenamiento: Entrenamiento) -> dict | None:
    fila = _csv_de(db, entrenamiento.id_paciente, entrenamiento.archivo)
    return leer_senal(fila.csv) if fila else None


def archivos_con_senal(db: Session, id_paciente: int) -> set[str]:
    return {
        fila.archivo
        for fila in db.query(EntrenamientoCsv.archivo).filter(EntrenamientoCsv.id_paciente == id_paciente)
    }


# --- Salida para la web -------------------------------------------------------------


def a_salida(entrenamiento: Entrenamiento, tiene_senal: bool, con_ciclos: bool = False) -> dict:
    """
    Lo que recibe la web, armado desde las columnas con las mismas claves del
    JSON del equipo. `promedios` y `multiciclo` en null si la sesión no se
    pudo analizar.
    """
    e = entrenamiento
    salida = {
        "id_entrenamiento": e.id_entrenamiento,
        "archivo": e.archivo,
        "fecha_hora": e.fecha_hora.isoformat() if e.fecha_hora else None,
        "duracion_s": e.duracion_s,
        "estado": e.estado,
        "fin": e.fin,
        "ciclos_objetivo": e.ciclos_objetivo,
        "n_ciclos_completos": e.n_ciclos_completos,
        "nivel_resistencia": e.nivel_resistencia,
        "modo_resistencia": e.modo_resistencia,
        "dc": e.dc_pct,
        "temperatura_c": e.temperatura_c,
        "humedad_rel_pct": e.humedad_rel_pct,
        "factor_btps": e.factor_btps,
        "formato_anterior": e.formato_anterior,
        "analizada": e.analizada,
        "tiene_senal": tiene_senal,
        "promedios": _leer(e, PROMEDIOS) if e.analizada else None,
        "multiciclo": _leer(e, MULTICICLO) if e.analizada else None,
    }
    if con_ciclos:
        salida["ciclos"] = [_leer(c, CICLO) for c in e.ciclos] if e.analizada else None
    return salida


def listar(db: Session, id_paciente: int) -> list[dict]:
    """
    Las sesiones del paciente, más recientes primero; las sin fecha al final
    (por orden de llegada).
    """
    con_senal = archivos_con_senal(db, id_paciente)
    entrenamientos = (
        db.query(Entrenamiento)
        .filter(Entrenamiento.id_paciente == id_paciente)
        .order_by(Entrenamiento.fecha_hora.is_(None), Entrenamiento.fecha_hora.desc(),
                  Entrenamiento.id_entrenamiento.desc())
        .all()
    )
    return [a_salida(e, e.archivo in con_senal) for e in entrenamientos]
