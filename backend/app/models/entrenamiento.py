"""
Sesiones de entrenamiento que sube el equipo (`POST /dispositivo/entrenamientos`
y `/dispositivo/entrenamientos/csv`, ver app/core/entrenamientos_dispositivo.py).

Cuatro tablas, sin datos anidados:
  - entrenamientos          una fila por sesión: datos de la sesión, ambiente,
                            promedios de los ciclos y métricas multiciclo.
  - ciclos_entrenamiento    una fila por ciclo, una columna por feature.
  - entrenamientos_csv      la señal cruda (el CSV tal cual llegó).
  - entrenamientos_json     el JSON original completo, como respaldo: así un
                            campo nuevo del equipo no se pierde aunque todavía
                            no tenga columna. La web no lo lee.

Convenciones de lo guardado (iguales al JSON del equipo, salvo la caída):
  - PIM, PEM, PIF y PEF con el signo del equipo (el nuevo manda la
    inspiración en negativo; las sesiones viejas, la PIM positiva). La web
    las muestra siempre con la convención clínica, vengan como vengan.
  - `caida_pim_pct` YA CORREGIDA: > 0 = la PIM cayó. Los JSON de la versión
    anterior del equipo la traen al revés; se invierte al guardarla.
  - Flujos en L/min, volúmenes en L, tiempos en s (desde el inicio del CSV).
  - Cualquier número puede ser NULL ("no se pudo calcular").
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _num() -> Mapped[float | None]:
    return mapped_column(Float, nullable=True)


def _ent() -> Mapped[int | None]:
    return mapped_column(Integer, nullable=True)


class Entrenamiento(Base):
    """
    TABLA ENTRENAMIENTOS — una sesión. Única por paciente y `archivo` (el
    nombre en la SD): si el equipo la vuelve a mandar, se reemplaza.
    """

    __tablename__ = "entrenamientos"
    __table_args__ = (UniqueConstraint("id_paciente", "archivo", name="uq_entrenamiento_archivo"),)

    id_entrenamiento: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    id_paciente: Mapped[int] = mapped_column(ForeignKey("usuarios.id_paciente"), index=True)
    # Nombre del archivo en la SD, sin la extensión (ej. "ent_20261114_153000").
    archivo: Mapped[str] = mapped_column(String(80))
    recibido_en: Mapped[datetime] = mapped_column(DateTime)

    # --- Sesión ---
    version: Mapped[int | None] = _ent()
    # JSON sin "id_entrenamiento": versión anterior del equipo.
    formato_anterior: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hora local del equipo (Argentina), sin zona. NULL si no tenía hora.
    fecha_hora: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    duracion_s: Mapped[float | None] = _num()
    estado: Mapped[str | None] = mapped_column(String(20), nullable=True)  # completa | incompleta | interrumpida
    fin: Mapped[str | None] = mapped_column(String(20), nullable=True)  # objetivo | detenida | sin_respiracion | tiempo_maximo
    ciclos_objetivo: Mapped[int | None] = _ent()
    nivel_resistencia: Mapped[int | None] = _ent()  # 1 (más abierta) a 5 (más cerrada)
    modo_resistencia: Mapped[str | None] = mapped_column(String(12), nullable=True)  # automatico | manual
    dc_pct: Mapped[float | None] = _num()  # duty cycle del servo
    # False si el equipo no pudo analizarla ("ciclos" y "resumen" en null).
    analizada: Mapped[bool] = mapped_column(Boolean, default=False)

    # --- Ambiente ---
    temperatura_c: Mapped[float | None] = _num()
    humedad_rel_pct: Mapped[float | None] = _num()
    factor_btps: Mapped[float | None] = _num()

    # --- Promedios de los ciclos (resumen.promedios) ---
    ti_prom_s: Mapped[float | None] = _num()
    te_prom_s: Mapped[float | None] = _num()
    pausa_prom_s: Mapped[float | None] = _num()
    ti_ttot_prom: Mapped[float | None] = _num()
    pif_prom_lmin: Mapped[float | None] = _num()
    pef_prom_lmin: Mapped[float | None] = _num()
    vol_insp_prom_l: Mapped[float | None] = _num()
    vol_esp_prom_l: Mapped[float | None] = _num()
    pim_prom_cmh2o: Mapped[float | None] = _num()
    pem_prom_cmh2o: Mapped[float | None] = _num()
    trabajo_insp_prom_j: Mapped[float | None] = _num()
    potencia_insp_prom_w: Mapped[float | None] = _num()

    # --- Multiciclo (resumen.multiciclo) ---
    n_ciclos_completos: Mapped[int | None] = _ent()
    n_fases_sueltas: Mapped[int | None] = _ent()
    periodo_medio_s: Mapped[float | None] = _num()
    frecuencia_rpm: Mapped[float | None] = _num()
    ventilacion_minuto_lmin: Mapped[float | None] = _num()
    trabajo_total_insp_j: Mapped[float | None] = _num()
    pendiente_pim_por_ciclo: Mapped[float | None] = _num()  # cmH2O/ciclo sobre |PIM|: > 0 = aumentó
    caida_pim_pct: Mapped[float | None] = _num()  # ya corregida: > 0 = la PIM cayó
    pif_max_lmin: Mapped[float | None] = _num()
    pif_max_ciclo: Mapped[int | None] = _ent()
    pef_max_lmin: Mapped[float | None] = _num()
    pef_max_ciclo: Mapped[int | None] = _ent()
    pim_max_cmh2o: Mapped[float | None] = _num()
    pim_max_ciclo: Mapped[int | None] = _ent()
    pem_max_cmh2o: Mapped[float | None] = _num()
    pem_max_ciclo: Mapped[int | None] = _ent()

    paciente = relationship("Paciente", back_populates="entrenamientos")
    ciclos = relationship(
        "CicloEntrenamiento", back_populates="entrenamiento", order_by="CicloEntrenamiento.orden",
        cascade="all, delete-orphan",
    )
    original = relationship(
        "EntrenamientoJson", back_populates="entrenamiento", uselist=False, cascade="all, delete-orphan",
    )


class CicloEntrenamiento(Base):
    """TABLA CICLOS_ENTRENAMIENTO — un ciclo completo (inspiración + espiración) de una sesión."""

    __tablename__ = "ciclos_entrenamiento"

    id_ciclo: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    id_entrenamiento: Mapped[int] = mapped_column(
        ForeignKey("entrenamientos.id_entrenamiento", ondelete="CASCADE"), index=True,
    )
    # Posición en la lista del JSON (0, 1, 2…), por si "numero" viene en null.
    orden: Mapped[int] = mapped_column(Integer)
    numero: Mapped[int | None] = _ent()

    t_inicio_s: Mapped[float | None] = _num()
    t_fin_s: Mapped[float | None] = _num()
    ti_s: Mapped[float | None] = _num()
    te_s: Mapped[float | None] = _num()
    pausa_s: Mapped[float | None] = _num()
    ti_ttot: Mapped[float | None] = _num()
    pif_lmin: Mapped[float | None] = _num()
    pef_lmin: Mapped[float | None] = _num()
    vol_insp_l: Mapped[float | None] = _num()
    vol_esp_l: Mapped[float | None] = _num()
    pim_cmh2o: Mapped[float | None] = _num()
    pem_cmh2o: Mapped[float | None] = _num()
    trabajo_insp_j: Mapped[float | None] = _num()
    potencia_insp_w: Mapped[float | None] = _num()
    t_pif_s: Mapped[float | None] = _num()
    t_pef_s: Mapped[float | None] = _num()
    t_pim_s: Mapped[float | None] = _num()
    t_pem_s: Mapped[float | None] = _num()

    entrenamiento = relationship("Entrenamiento", back_populates="ciclos")


class EntrenamientoJson(Base):
    """TABLA ENTRENAMIENTOS_JSON — el JSON de la sesión tal como llegó (respaldo)."""

    __tablename__ = "entrenamientos_json"

    id_entrenamiento: Mapped[int] = mapped_column(
        ForeignKey("entrenamientos.id_entrenamiento", ondelete="CASCADE"), primary_key=True,
    )
    json: Mapped[dict] = mapped_column(JSON)

    entrenamiento = relationship("Entrenamiento", back_populates="original")


class EntrenamientoCsv(Base):
    """
    TABLA ENTRENAMIENTOS_CSV — la señal de una sesión, tal cual llegó:
    `tiempo_ms,presion_cmh2o,flujo_lmin,v_flujo_v,v_pim_v,flujo_proc_lmin`
    (los equipos viejos no mandan `flujo_proc_lmin`). Se guarda por paciente +
    `archivo`, no por id: puede llegar antes que el JSON o repetida. Puede
    pesar cientos de KB, por eso LONGTEXT.
    """

    __tablename__ = "entrenamientos_csv"
    __table_args__ = (UniqueConstraint("id_paciente", "archivo", name="uq_entrenamiento_csv_archivo"),)

    id_csv: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    id_paciente: Mapped[int] = mapped_column(ForeignKey("usuarios.id_paciente"), index=True)
    archivo: Mapped[str] = mapped_column(String(80))
    csv: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"))
    recibido_en: Mapped[datetime] = mapped_column(DateTime)
