"""
Borrar una medición desde la web (el médico la considera inválida, o por lo
que sea). Se va todo lo que cuelga de ella: los valores, la señal, las notas
y la marca de oculta. Lo único que queda es el nombre de su archivo, para no
volver a crearla si el equipo la manda de nuevo al sincronizar (ver
`borrar_evaluacion` y `borrar_entrenamiento`).

Las notas se reconocen por su clave (ver frontend/src/anotaciones/useAnotaciones.ts):
  - "evaluacion/<id>/<grafico>" y "entrenamiento/<id>[/<grafico>]": las de la señal.
  - "evolucion/<evaluaciones|entrenamientos>/<variable>" con punto = el id: las de
    los gráficos de evolución.
  - Sin gráfico, con `sesion`: los comentarios de una sesión de consultorio. Se
    borran sólo si ya no queda ninguna evaluación de esa sesión.
"""

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.entrenamientos_dispositivo import borrar_entrenamiento
from app.core.evaluaciones_dispositivo import borrar_evaluacion
from app.models.anotacion import Anotacion
from app.models.entrenamiento import Entrenamiento
from app.models.evaluacion import Evaluacion
from app.models.medicion_oculta import MedicionOculta


def _borrar_notas(db: Session, id_paciente: int, condicion) -> None:
    db.query(Anotacion).filter(Anotacion.id_paciente == id_paciente, condicion).delete(synchronize_session=False)


def _borrar_marca_oculta(db: Session, tipo: str, id_medicion: int) -> None:
    db.query(MedicionOculta).filter(MedicionOculta.tipo == tipo, MedicionOculta.id_medicion == id_medicion).delete(
        synchronize_session=False,
    )


def borrar_evaluacion_completa(db: Session, evaluacion: Evaluacion) -> None:
    id_paciente, id_evaluacion, sesion = evaluacion.id_paciente, evaluacion.id_evaluacion, evaluacion.fecha_hora
    _borrar_notas(db, id_paciente, or_(
        Anotacion.grafico.like(f"evaluacion/{id_evaluacion}/%"),
        and_(Anotacion.grafico.like("evolucion/evaluaciones/%"), Anotacion.punto == str(id_evaluacion)),
    ))
    _borrar_marca_oculta(db, "evaluacion", id_evaluacion)
    borrar_evaluacion(db, evaluacion)
    db.flush()

    queda_otra = (
        db.query(Evaluacion.id_evaluacion)
        .filter(Evaluacion.id_paciente == id_paciente, Evaluacion.fecha_hora == sesion)
        .first()
    ) is not None
    if not queda_otra:
        _borrar_notas(db, id_paciente, and_(Anotacion.grafico.is_(None), Anotacion.sesion == sesion))


def borrar_entrenamiento_completo(db: Session, entrenamiento: Entrenamiento, id_medico: int) -> None:
    id_paciente, id_entrenamiento = entrenamiento.id_paciente, entrenamiento.id_entrenamiento
    _borrar_notas(db, id_paciente, or_(
        Anotacion.grafico == f"entrenamiento/{id_entrenamiento}",
        Anotacion.grafico.like(f"entrenamiento/{id_entrenamiento}/%"),
        and_(Anotacion.grafico.like("evolucion/entrenamientos/%"), Anotacion.punto == str(id_entrenamiento)),
    ))
    _borrar_marca_oculta(db, "entrenamiento", id_entrenamiento)
    borrar_entrenamiento(db, entrenamiento, id_medico)
    db.flush()
