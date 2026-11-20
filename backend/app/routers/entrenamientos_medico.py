"""
El visor de una sesión de entrenamiento (vista del médico): la sesión con
sus ciclos y la señal cruda del CSV. El listado está en
`GET /medicos/me/pacientes/{id}/entrenamientos` (app/routers/medicos.py).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_medico
from app.core.entrenamientos_dispositivo import a_salida, archivos_con_senal, senal_de
from app.models.entrenamiento import Entrenamiento
from app.models.medico import Medico
from app.models.medico_paciente import MedicoPaciente
from app.schemas.entrenamiento import EntrenamientoDetalleOut, SenalEntrenamientoOut

router = APIRouter(
    prefix="/medicos/me/pacientes/{id_paciente}/entrenamientos/{id_entrenamiento}",
    tags=["entrenamientos (medico)"],
)


def _entrenamiento(medico: Medico, id_paciente: int, id_entrenamiento: int, db: Session) -> Entrenamiento:
    vinculado = (
        db.query(MedicoPaciente)
        .filter(MedicoPaciente.id_medico == medico.id_medico, MedicoPaciente.id_paciente == id_paciente)
        .first()
    )
    if vinculado is None:
        raise HTTPException(status_code=403, detail="No tenés a ese paciente vinculado.")
    entrenamiento = db.get(Entrenamiento, id_entrenamiento)
    if entrenamiento is None or entrenamiento.id_paciente != id_paciente:
        raise HTTPException(status_code=404, detail="No encontramos esa sesión de entrenamiento.")
    return entrenamiento


@router.get("", response_model=EntrenamientoDetalleOut)
def detalle(
    id_paciente: int, id_entrenamiento: int,
    medico: Medico = Depends(get_current_medico), db: Session = Depends(get_db),
):
    """La sesión con todos sus ciclos."""
    entrenamiento = _entrenamiento(medico, id_paciente, id_entrenamiento, db)
    tiene_senal = entrenamiento.archivo in archivos_con_senal(db, id_paciente)
    return a_salida(entrenamiento, tiene_senal, con_ciclos=True)


@router.get("/senal", response_model=SenalEntrenamientoOut)
def senal(
    id_paciente: int, id_entrenamiento: int,
    medico: Medico = Depends(get_current_medico), db: Session = Depends(get_db),
):
    """La señal cruda (tiempo, presión, flujo). 404 si el equipo no la mandó."""
    entrenamiento = _entrenamiento(medico, id_paciente, id_entrenamiento, db)
    datos = senal_de(db, entrenamiento)
    if datos is None:
        raise HTTPException(status_code=404, detail="Señal no disponible.")
    return datos
