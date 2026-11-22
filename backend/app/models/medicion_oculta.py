from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

TIPOS_MEDICION = ("evaluacion", "entrenamiento")


class MedicionOculta(Base):
    """
    TABLA MEDICIONES_OCULTAS — evaluaciones o entrenamientos que un médico
    marcó como fallidos. Siguen apareciendo en las tablas de la ficha (en
    gris), pero no entran en los gráficos de evolución, ni en el CSV, ni en
    el informe. Sin fila = la medición se ve.

    Va en una tabla aparte para no tocar las que llena el equipo. Como la
    frecuencia, es del paciente: todos sus médicos la ven igual.
    """

    __tablename__ = "mediciones_ocultas"
    __table_args__ = (UniqueConstraint("tipo", "id_medicion", name="uq_medicion_oculta"),)

    id_oculta: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    id_paciente: Mapped[int] = mapped_column(ForeignKey("usuarios.id_paciente"), index=True)
    # "evaluacion" (id_evaluacion) o "entrenamiento" (id_entrenamiento).
    tipo: Mapped[str] = mapped_column(String(14))
    id_medicion: Mapped[int] = mapped_column(Integer)
    # Quién la ocultó y cuándo (UTC, sin zona, como el resto de las fechas).
    id_medico: Mapped[int] = mapped_column(ForeignKey("medicos.id_medico"))
    ocultada_en: Mapped[datetime] = mapped_column(DateTime)
