from pydantic import BaseModel, Field


class EntrenamientoOut(BaseModel):
    """
    Una sesión de entrenamiento, como la arma `a_salida`
    (app/core/entrenamientos_dispositivo.py). Cualquier número puede venir en
    null ("no se pudo calcular"). PIM/PEM con el signo del equipo (PIM
    positiva, PEM negativa); `multiciclo.caida_pim_pct` > 0 = la PIM cayó.
    """

    id_entrenamiento: int
    archivo: str
    # Hora local del equipo; null si no tenía hora.
    fecha_hora: str | None
    duracion_s: float | None
    estado: str | None  # completa | incompleta | interrumpida
    fin: str | None  # objetivo | detenida | sin_respiracion | tiempo_maximo
    ciclos_objetivo: int | None
    n_ciclos_completos: int | None
    nivel_resistencia: int | None
    modo_resistencia: str | None  # automatico | manual
    dc: float | None
    temperatura_c: float | None
    humedad_rel_pct: float | None
    factor_btps: float | None
    # JSON de una versión anterior del equipo (sin "id_entrenamiento").
    formato_anterior: bool
    # False si el equipo no pudo analizarla ("ciclos" y "resumen" en null).
    analizada: bool
    tiene_senal: bool
    promedios: dict[str, float | None] | None
    multiciclo: dict[str, float | None] | None


class EntrenamientoDetalleOut(EntrenamientoOut):
    """La sesión con sus ciclos (null si no se pudo analizar)."""

    ciclos: list[dict[str, float | None]] | None


class SenalEntrenamientoOut(BaseModel):
    """
    La señal del CSV, sin tocar signos (presión positiva y flujo negativo al
    inspirar). Un null en un flujo es un hueco (celda vacía), no un 0.
      - flujo_proc_lmin: el flujo PROCESADO por el equipo (sentido por fase,
        venturi, BTPS y filtro de picos): el mismo de las métricas del JSON.
        Null si el CSV no lo trae (equipo viejo) o viene vacío (sin análisis).
      - flujo_lmin: el flujo crudo; sólo para diagnóstico.
    """

    tiempo_s: list[float]
    presion_cmh2o: list[float]
    flujo_lmin: list[float | None]
    flujo_proc_lmin: list[float | None] | None


class SubirEntrenamientoRequest(BaseModel):
    """Lo que manda el equipo en POST /dispositivo/entrenamientos."""

    usuario: str = Field(max_length=25)
    archivo: str = Field(min_length=1, max_length=80)
    resumen: dict
