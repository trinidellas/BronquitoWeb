"""
Lo que el médico fija desde la web y viaja al equipo en
`GET /dispositivo/frecuencia` (ver app/routers/dispositivo.py):

- La resistencia de la válvula: modo automático o manual, y el nivel manual
  (1 = más abierta … 5 = más cerrada). El nivel automático lo calcula y lo
  guarda sólo el equipo: la web no lo manda ni lo conoce.
- Las repeticiones por sesión: cuántas respiraciones contra la válvula le
  pide el equipo en cada entrenamiento (vuelven en cada sesión como
  `ciclos_objetivo`).
- Para pacientes con sexo "X": qué ecuación (hombre o mujer) usar para los
  valores predichos.

Como la frecuencia, la configuración es del paciente: todos sus médicos
vinculados ven y cambian la misma.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_serializer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_medico
from app.core.predichos import predichos, sexo_para_ecuacion
from app.core.timezone import hoy_argentina
from app.models.configuracion_dispositivo import (
    ConfiguracionRepeticiones,
    ConfiguracionResistencia,
    EcuacionPredichos,
    FrecuenciaConfirmada,
)
from app.models.frecuencia_recomendada import FrecuenciaRecomendada
from app.models.medico import Medico
from app.models.medico_paciente import MedicoPaciente
from app.models.paciente import Paciente

router = APIRouter(prefix="/medicos/me/pacientes/{id_paciente}", tags=["resistencia (medico)"])

NIVEL_POR_DEFECTO = 3
REPETICIONES_MIN = 1
REPETICIONES_MAX = 30


# --- Schemas (acá mismo: sólo los usa este router) ------------------------------


def _iso_utc(valor: datetime | None) -> str | None:
    return valor.replace(tzinfo=timezone.utc).isoformat() if valor else None


class ResistenciaOut(BaseModel):
    id_resistencia: int
    modo: Literal["automatico", "manual"]
    nivel_manual: int
    enviado: str
    creado_en: datetime
    # Cuándo la guardó el equipo; null = todavía no sincronizó.
    confirmada_en: datetime | None

    @field_serializer("creado_en", "confirmada_en")
    def _fechas(self, valor: datetime | None) -> str | None:
        return _iso_utc(valor)


class RepeticionesOut(BaseModel):
    id_repeticiones: int
    repeticiones: int
    enviado: str
    creado_en: datetime
    # Cuándo la guardó el equipo; null = todavía no sincronizó.
    confirmada_en: datetime | None

    @field_serializer("creado_en", "confirmada_en")
    def _fechas(self, valor: datetime | None) -> str | None:
        return _iso_utc(valor)


class PredichosOut(BaseModel):
    fvc_predicha_L: float | None
    pim_predicha_cmh2o: float | None


class ConfiguracionEquipoOut(BaseModel):
    """Lo que muestra el modal de resistencia en la ficha del paciente."""

    resistencia: ResistenciaOut | None
    # Null si el médico todavía no las fijó (el equipo usa las suyas).
    repeticiones: RepeticionesOut | None
    sexo: str
    # 'M' / 'F' que se usa para los predichos; para un "X" sin elegir, null.
    sexo_ecuacion: str | None
    predichos: PredichosOut
    # La frecuencia vigente ya llegó al equipo (null si no hay frecuencia).
    frecuencia_confirmada: bool | None


class ResistenciaCrearRequest(BaseModel):
    modo: Literal["automatico", "manual"]
    # En automático se puede omitir: se conserva el último nivel manual.
    nivel_manual: int | None = Field(default=None, ge=1, le=5)


class RepeticionesCrearRequest(BaseModel):
    repeticiones: int = Field(ge=REPETICIONES_MIN, le=REPETICIONES_MAX)


class EcuacionPredichosRequest(BaseModel):
    sexo_ecuacion: Literal["M", "F"]


# --- Helpers ----------------------------------------------------------------------


def _paciente_vinculado(medico: Medico, id_paciente: int, db: Session) -> Paciente:
    vinculado = (
        db.query(MedicoPaciente)
        .filter(MedicoPaciente.id_medico == medico.id_medico, MedicoPaciente.id_paciente == id_paciente)
        .first()
    )
    paciente = db.get(Paciente, id_paciente) if vinculado else None
    if paciente is None:
        raise HTTPException(status_code=403, detail="No tenés a ese paciente vinculado.")
    return paciente


def _ultima_resistencia(id_paciente: int, db: Session) -> ConfiguracionResistencia | None:
    return (
        db.query(ConfiguracionResistencia)
        .filter(ConfiguracionResistencia.id_paciente == id_paciente)
        .order_by(ConfiguracionResistencia.id_resistencia.desc())
        .first()
    )


def _ultimas_repeticiones(id_paciente: int, db: Session) -> ConfiguracionRepeticiones | None:
    return (
        db.query(ConfiguracionRepeticiones)
        .filter(ConfiguracionRepeticiones.id_paciente == id_paciente)
        .order_by(ConfiguracionRepeticiones.id_repeticiones.desc())
        .first()
    )


def _configuracion(paciente: Paciente, db: Session) -> ConfiguracionEquipoOut:
    resistencia = _ultima_resistencia(paciente.id_paciente, db)
    repeticiones = _ultimas_repeticiones(paciente.id_paciente, db)

    frecuencia = (
        db.query(FrecuenciaRecomendada)
        .filter(
            FrecuenciaRecomendada.id_paciente == paciente.id_paciente,
            FrecuenciaRecomendada.vigente_desde <= hoy_argentina(),
        )
        .order_by(FrecuenciaRecomendada.vigente_desde.desc(), FrecuenciaRecomendada.id_frecuencia.desc())
        .first()
    )
    frecuencia_confirmada = None
    if frecuencia is not None:
        frecuencia_confirmada = db.get(FrecuenciaConfirmada, frecuencia.id_frecuencia) is not None

    return ConfiguracionEquipoOut(
        resistencia=ResistenciaOut(
            id_resistencia=resistencia.id_resistencia,
            modo=resistencia.modo,
            nivel_manual=resistencia.nivel_manual,
            enviado=resistencia.enviado.isoformat(),
            creado_en=resistencia.creado_en,
            confirmada_en=resistencia.confirmada_en,
        ) if resistencia else None,
        repeticiones=RepeticionesOut(
            id_repeticiones=repeticiones.id_repeticiones,
            repeticiones=repeticiones.repeticiones,
            enviado=repeticiones.enviado.isoformat(),
            creado_en=repeticiones.creado_en,
            confirmada_en=repeticiones.confirmada_en,
        ) if repeticiones else None,
        sexo=paciente.sexo,
        sexo_ecuacion=sexo_para_ecuacion(paciente, db),
        predichos=PredichosOut(**predichos(paciente, db)),
        frecuencia_confirmada=frecuencia_confirmada,
    )


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Endpoints --------------------------------------------------------------------


@router.get("/configuracion-equipo", response_model=ConfiguracionEquipoOut)
def ver_configuracion(id_paciente: int, medico: Medico = Depends(get_current_medico), db: Session = Depends(get_db)):
    """Resistencia vigente, predichos y si el equipo ya recibió lo último."""
    return _configuracion(_paciente_vinculado(medico, id_paciente, db), db)


@router.post("/resistencia", response_model=ConfiguracionEquipoOut, status_code=201)
def fijar_resistencia(
    id_paciente: int,
    payload: ResistenciaCrearRequest,
    medico: Medico = Depends(get_current_medico),
    db: Session = Depends(get_db),
):
    """
    Agrega una configuración nueva (no pisa las anteriores): tiene otro id,
    así el equipo se da cuenta de que cambió la próxima vez que sincroniza.
    """
    paciente = _paciente_vinculado(medico, id_paciente, db)
    if payload.modo == "manual" and payload.nivel_manual is None:
        raise HTTPException(status_code=422, detail="En modo manual hay que elegir un nivel del 1 al 5.")

    anterior = _ultima_resistencia(paciente.id_paciente, db)
    nivel = payload.nivel_manual or (anterior.nivel_manual if anterior else NIVEL_POR_DEFECTO)

    db.add(ConfiguracionResistencia(
        id_paciente=paciente.id_paciente,
        id_medico=medico.id_medico,
        modo=payload.modo,
        nivel_manual=nivel,
        enviado=hoy_argentina(),
        creado_en=_ahora_utc(),
    ))
    db.commit()
    return _configuracion(paciente, db)


@router.post("/repeticiones", response_model=ConfiguracionEquipoOut, status_code=201)
def fijar_repeticiones(
    id_paciente: int,
    payload: RepeticionesCrearRequest,
    medico: Medico = Depends(get_current_medico),
    db: Session = Depends(get_db),
):
    """
    Como la resistencia: agrega una fila nueva (otro id), así el equipo se da
    cuenta de que cambió la próxima vez que sincroniza.
    """
    paciente = _paciente_vinculado(medico, id_paciente, db)
    db.add(ConfiguracionRepeticiones(
        id_paciente=paciente.id_paciente,
        id_medico=medico.id_medico,
        repeticiones=payload.repeticiones,
        enviado=hoy_argentina(),
        creado_en=_ahora_utc(),
    ))
    db.commit()
    return _configuracion(paciente, db)


@router.put("/ecuacion-predichos", response_model=ConfiguracionEquipoOut)
def elegir_ecuacion(
    id_paciente: int,
    payload: EcuacionPredichosRequest,
    medico: Medico = Depends(get_current_medico),
    db: Session = Depends(get_db),
):
    """Sólo para pacientes con sexo "X": ecuación de hombre o de mujer."""
    paciente = _paciente_vinculado(medico, id_paciente, db)
    if paciente.sexo != "X":
        raise HTTPException(
            status_code=409, detail="Sólo se elige la ecuación para pacientes con sexo \"X\".",
        )

    eleccion = db.get(EcuacionPredichos, paciente.id_paciente)
    if eleccion is None:
        eleccion = EcuacionPredichos(id_paciente=paciente.id_paciente)
        db.add(eleccion)
    eleccion.sexo_ecuacion = payload.sexo_ecuacion
    eleccion.id_medico = medico.id_medico
    eleccion.actualizado_en = _ahora_utc()
    db.commit()
    return _configuracion(paciente, db)
