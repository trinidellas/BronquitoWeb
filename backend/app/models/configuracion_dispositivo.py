"""
Configuración que la web le manda al dispositivo junto con la frecuencia
(`GET /dispositivo/frecuencia`, ver app/routers/dispositivo.py). Son tablas
nuevas: no tocan ninguna de las existentes, así `create_all` las crea sin
migrar nada.

Reparto de quién es dueño de qué (para que la web y el equipo nunca
escriban el mismo dato):
  - La web: el modo de la resistencia (automático/manual) y el nivel manual.
  - El equipo: el nivel automático. Lo calcula después de cada evaluación y
    lo guarda sólo en su SD; la web no lo manda ni lo guarda.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

MODOS_RESISTENCIA = ("automatico", "manual")


class ConfiguracionResistencia(Base):
    """
    TABLA CONFIGURACION_RESISTENCIA — historial de cómo fijó el médico la
    resistencia de la válvula (1 = más abierta … 5 = más cerrada). Como
    `frecuencia_recomendada`, cada cambio agrega una fila: la vigente es la
    de `id_resistencia` más alto del paciente.

    - modo "automatico": el equipo usa el nivel que calcula él y exige una
      evaluación vigente (15 días) para entrenar.
    - modo "manual": el equipo usa `nivel_manual` y no hay vencimiento.
    `nivel_manual` se guarda siempre (también en automático), así el equipo
    tiene el último valor si se pasa a manual.
    """

    __tablename__ = "configuracion_resistencia"

    id_resistencia: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    id_paciente: Mapped[int] = mapped_column(ForeignKey("usuarios.id_paciente"), index=True)
    id_medico: Mapped[int] = mapped_column(ForeignKey("medicos.id_medico"))

    modo: Mapped[str] = mapped_column(String(12))
    nivel_manual: Mapped[int] = mapped_column(Integer)

    # Fecha (Argentina) en que el médico la fijó: viaja al equipo como "enviado".
    enviado: Mapped[date] = mapped_column(Date)
    creado_en: Mapped[datetime] = mapped_column(DateTime)
    # Cuándo el equipo avisó que la guardó (POST /dispositivo/resistencia/confirmar).
    confirmada_en: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FrecuenciaConfirmada(Base):
    """
    TABLA FRECUENCIA_CONFIRMADA — qué entradas de `frecuencia_recomendada`
    ya guardó el equipo (POST /dispositivo/frecuencia/confirmar). Va aparte
    para no agregarle columnas a esa tabla.
    """

    __tablename__ = "frecuencia_confirmada"

    id_frecuencia: Mapped[int] = mapped_column(
        ForeignKey("frecuencia_recomendada.id_frecuencia"), primary_key=True,
    )
    confirmada_en: Mapped[datetime] = mapped_column(DateTime)


class EcuacionPredichos(Base):
    """
    TABLA ECUACION_PREDICHOS — para pacientes con sexo "X": qué ecuación
    (la de hombre "M" o la de mujer "F") eligió el médico para calcular los
    valores predichos de FVC y PIM. Se aplica a las dos. Sin fila, los
    predichos de un paciente "X" van en null.
    """

    __tablename__ = "ecuacion_predichos"

    id_paciente: Mapped[int] = mapped_column(ForeignKey("usuarios.id_paciente"), primary_key=True)
    sexo_ecuacion: Mapped[str] = mapped_column(String(1))
    id_medico: Mapped[int] = mapped_column(ForeignKey("medicos.id_medico"))
    actualizado_en: Mapped[datetime] = mapped_column(DateTime)
