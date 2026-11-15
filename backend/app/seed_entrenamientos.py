"""
Entrenamientos inventados para Malena, con el formato que manda el equipo
(JSON de la sesión + CSV de la señal). Se guardan con las mismas funciones
que usa `POST /dispositivo/entrenamientos`, así pasan por el mismo camino que
los reales.

Doce semanas, martes, jueves y sábado, salteando la semana del resfrío y
alguna sesión suelta (igual que el historial de app/seed.py). Mejora de a
poco; dentro de cada sesión la PIM cae un poco hacia el final (fatiga).
Incluye además, para probar el visor:
  - una sesión de la versión anterior del equipo (sin "id_entrenamiento",
    sin hora y con `caida_pim_pct` con el signo viejo);
  - una sesión interrumpida que el equipo no pudo analizar
    ("ciclos" y "resumen" en null).
Las últimas sesiones traen CSV; las demás no ("Señal no disponible").
"""

import math
import random
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.entrenamientos_dispositivo import guardar_csv, guardar_entrenamiento
from app.models.paciente import Paciente

DIAS_ENTRENAMIENTO = [1, 3, 5]  # martes, jueves y sábado (0 = lunes)
CICLOS_OBJETIVO = 30
SESIONES_CON_CSV = 4
MUESTRAS_POR_SEGUNDO = 100
CMH2O_L_A_J = 0.0980665  # 1 cmH2O·L = 0,0980665 J


def _promedio(valores: list[float]) -> float | None:
    return sum(valores) / len(valores) if valores else None


def _r(valor: float | None, decimales: int = 2) -> float | None:
    return round(valor, decimales) if valor is not None else None


def _ciclos(azar: random.Random, n: int, p: float, forma: float, t0: float) -> list[dict]:
    """`n` ciclos seguidos desde `t0`. `p` (0 → 1) es el progreso del paciente."""
    pim_base = (36 + 20 * p) * forma
    fatiga = azar.uniform(0.08, 0.22)
    ciclos = []
    t = t0
    for i in range(n):
        avance = i / max(n - 1, 1)
        ti = azar.uniform(0.9, 1.3)
        te = azar.uniform(0.8, 1.1)
        pausa = azar.uniform(0.02, 0.25)
        pim = pim_base * (1 - fatiga * avance) + azar.gauss(0, 1.2)
        pem = -((30 + 14 * p) * forma + azar.gauss(0, 1.5))
        pif = (150 + 40 * p) * forma * (1 - 0.5 * fatiga * avance) + azar.gauss(0, 4)
        pef = (165 + 30 * p) * forma + azar.gauss(0, 5)
        vol_insp = (1.25 + 0.45 * p) * forma * (1 - 0.4 * fatiga * avance) + azar.gauss(0, 0.04)
        vol_esp = vol_insp * azar.uniform(1.0, 1.06)
        trabajo = pim * vol_insp * CMH2O_L_A_J * 0.62
        inicio_esp = t + ti + pausa
        ciclos.append({
            "numero": i + 1,
            "t_inicio_s": _r(t), "t_fin_s": _r(inicio_esp + te),
            "ti_s": _r(ti), "te_s": _r(te), "pausa_s": _r(pausa), "ti_ttot": _r(ti / (ti + te + pausa)),
            "pif_Lmin": _r(pif, 1), "pef_Lmin": _r(pef, 1),
            "vol_insp_L": _r(vol_insp), "vol_esp_L": _r(vol_esp),
            "pim_cmH2O": _r(pim, 1), "pem_cmH2O": _r(pem, 1),
            "trabajo_insp_J": _r(trabajo), "potencia_insp_W": _r(trabajo / ti),
            "t_pif_s": _r(t + ti * 0.5), "t_pef_s": _r(inicio_esp + te * 0.5),
            "t_pim_s": _r(t + ti * 0.5), "t_pem_s": _r(inicio_esp + te * 0.5),
        })
        t = inicio_esp + te + azar.uniform(0.05, 0.4)
    return ciclos


def _resumen(ciclos: list[dict]) -> dict:
    """Promedios y multiciclo, con los mismos criterios que el equipo."""
    claves = ["ti_s", "te_s", "pausa_s", "ti_ttot", "pif_Lmin", "pef_Lmin", "vol_insp_L", "vol_esp_L",
              "pim_cmH2O", "pem_cmH2O", "trabajo_insp_J", "potencia_insp_W"]
    promedios = {c: _r(_promedio([ciclo[c] for ciclo in ciclos]), 2) for c in claves}

    n = len(ciclos)
    pims = [abs(c["pim_cmH2O"]) for c in ciclos]
    # Período: de un inicio de ciclo al siguiente.
    if n > 1:
        periodo = (ciclos[-1]["t_inicio_s"] - ciclos[0]["t_inicio_s"]) / (n - 1)
    else:
        periodo = ciclos[0]["t_fin_s"] - ciclos[0]["t_inicio_s"]
    frecuencia = 60 / periodo if periodo else None

    pendiente = None
    if n > 1:
        xs = list(range(1, n + 1))
        mx, my = _promedio(xs), _promedio(pims)
        pendiente = sum((x - mx) * (y - my) for x, y in zip(xs, pims)) / sum((x - mx) ** 2 for x in xs)
    tercio = max(n // 3, 1)
    primero, ultimo = _promedio(pims[:tercio]), _promedio(pims[-tercio:])
    caida = (primero - ultimo) / primero * 100 if n >= 3 and primero else None

    def maximo(clave: str, menor: bool = False) -> tuple[float, int]:
        elegido = (min if menor else max)(ciclos, key=lambda c: c[clave])
        return elegido[clave], elegido["numero"]

    pif_max, pif_ciclo = maximo("pif_Lmin")
    pef_max, pef_ciclo = maximo("pef_Lmin")
    pim_max, pim_ciclo = maximo("pim_cmH2O")
    pem_max, pem_ciclo = maximo("pem_cmH2O", menor=True)
    return {
        "promedios": promedios,
        "multiciclo": {
            "n_ciclos_completos": n, "n_fases_sueltas": 0,
            "periodo_medio_s": _r(periodo), "frecuencia_rpm": _r(frecuencia, 1),
            "ventilacion_minuto_Lmin": _r(promedios["vol_insp_L"] * frecuencia, 1) if frecuencia else None,
            "trabajo_total_insp_J": _r(sum(c["trabajo_insp_J"] for c in ciclos), 1),
            "pendiente_pim_por_ciclo": _r(pendiente),
            "caida_pim_pct": _r(caida, 1),
            "pif_max_Lmin": pif_max, "pif_max_ciclo": pif_ciclo,
            "pef_max_Lmin": pef_max, "pef_max_ciclo": pef_ciclo,
            "pim_max_cmH2O": pim_max, "pim_max_ciclo": pim_ciclo,
            "pem_max_cmH2O": pem_max, "pem_max_ciclo": pem_ciclo,
        },
    }


def _csv(azar: random.Random, ciclos: list[dict], duracion: float, factor_btps: float, con_procesado: bool = True) -> str:
    """
    Señal a 100 Hz como la escribe el equipo:
      - presion_cmh2o: positiva al inspirar y negativa al espirar.
      - flujo_proc_lmin: el flujo procesado (negativo al inspirar), con el que
        salen las métricas: su pico en cada ciclo es -pif_Lmin / pef_Lmin.
        Alguna celda suelta vacía, como puede pasar en el equipo.
      - flujo_lmin: el crudo (sin BTPS, con ruido).
    Con `con_procesado=False`, como un equipo viejo: sin la columna nueva.
    """
    encabezado = "tiempo_ms,presion_cmh2o,flujo_lmin,v_flujo_v,v_pim_v"
    filas = [encabezado + (",flujo_proc_lmin" if con_procesado else "")]
    for k in range(int(duracion * MUESTRAS_POR_SEGUNDO) + 1):
        t = k / MUESTRAS_POR_SEGUNDO
        presion, procesado = azar.gauss(0, 0.25), azar.gauss(0, 0.3)
        for c in ciclos:
            fin_insp = c["t_inicio_s"] + c["ti_s"]
            inicio_esp = fin_insp + c["pausa_s"]
            if c["t_inicio_s"] <= t < fin_insp:
                forma = math.sin(math.pi * (t - c["t_inicio_s"]) / c["ti_s"])
                presion += c["pim_cmH2O"] * forma
                procesado = -c["pif_Lmin"] * forma ** 1.3
                break
            if inicio_esp <= t < c["t_fin_s"]:
                forma = math.sin(math.pi * (t - inicio_esp) / c["te_s"])
                presion += c["pem_cmH2O"] * forma
                procesado = c["pef_Lmin"] * forma ** 1.3
                break
        crudo = procesado / factor_btps + azar.gauss(0, 1.5)
        fila = f"{round(t * 1000)},{presion:.2f},{crudo:.2f},{1.65 + crudo / 400:.3f},{0.5 + presion / 100:.3f}"
        if con_procesado:
            fila += "," + ("" if azar.random() < 0.002 else f"{procesado:.1f}")
        filas.append(fila)
    return "\n".join(filas) + "\n"


def _sesion(azar: random.Random, fecha: datetime | None, p: float, mal_dia: bool, nivel: int,
            anterior: bool = False) -> tuple[str, dict, str | None, bool]:
    """(archivo, JSON, CSV o None, si se puede mandar CSV) de una sesión."""
    forma = 0.88 if mal_dia else 1.0
    archivo = f"ent_{fecha:%Y%m%d_%H%M%S}" if fecha else f"ent_SINHORA_{azar.randrange(1, 99)}"

    sorteo = azar.random()
    if sorteo < 0.75:
        n, estado, fin = CICLOS_OBJETIVO, "completa", "objetivo"
    elif sorteo < 0.92:
        n, estado, fin = azar.randrange(14, CICLOS_OBJETIVO), "incompleta", "detenida"
    else:
        n, estado, fin = azar.randrange(8, 20), "interrumpida", azar.choice(["sin_respiracion", "tiempo_maximo"])

    ciclos = _ciclos(azar, n, p, forma, t0=azar.uniform(1.2, 2.0))
    duracion = ciclos[-1]["t_fin_s"] + azar.uniform(0.8, 1.5)
    datos = {
        "version": 1,
        "id_entrenamiento": archivo,
        "fecha_hora": f"{fecha:%Y-%m-%d %H:%M:%S}" if fecha else None,
        "sincronizado": True,
        "duracion_s": round(duracion, 2),
        "dc": None,
        "estado": estado,
        "fin": fin,
        "ciclos_objetivo": CICLOS_OBJETIVO,
        "nivel_resistencia": nivel,
        "modo_resistencia": "automatico",
        "temperatura_c": round(19 + 4 * p + azar.gauss(0, 1.0), 1),
        "humedad_rel_pct": round(azar.uniform(45, 65)),
        "factor_btps": round(azar.uniform(1.07, 1.10), 4),
        "ciclos": ciclos,
        "resumen": _resumen(ciclos),
    }
    if anterior:
        # Versión anterior del equipo: sin id, sin hora, sin resistencia ni ambiente,
        # y la caída de la PIM con el signo al revés (negativo = cayó).
        for clave in ("version", "id_entrenamiento", "fecha_hora", "nivel_resistencia", "modo_resistencia",
                      "temperatura_c", "humedad_rel_pct", "factor_btps"):
            datos.pop(clave)
        caida = datos["resumen"]["multiciclo"]["caida_pim_pct"]
        datos["resumen"]["multiciclo"]["caida_pim_pct"] = -caida if caida is not None else None
    csv = _csv(azar, ciclos, duracion, datos.get("factor_btps") or 1.08, con_procesado=not anterior)
    return archivo, datos, csv, True


def sembrar_entrenamientos_demo(db: Session, paciente: Paciente, hoy: datetime) -> int:
    """Carga las sesiones de ejemplo de `paciente`. Devuelve cuántas cargó."""
    azar = random.Random(20261114)
    inicio = (hoy - timedelta(days=82)).date()
    fin = (hoy - timedelta(days=1)).date()
    resfrio_desde = (hoy - timedelta(days=38)).date()
    resfrio_hasta = (hoy - timedelta(days=31)).date()

    dias: list[date] = []
    dia = inicio
    while dia <= fin:
        if (
            dia.weekday() in DIAS_ENTRENAMIENTO
            and not resfrio_desde <= dia <= resfrio_hasta
            and azar.random() > 0.12
        ):
            dias.append(dia)
        dia += timedelta(days=1)

    sesiones = []
    for dia in dias:
        p = (dia - inicio).days / (fin - inicio).days
        mal_dia = (dia - resfrio_hasta).days in range(1, 7) or azar.random() < 0.08
        nivel = min(1 + int(p * 4), 4)
        fecha = datetime(dia.year, dia.month, dia.day, azar.choice([9, 10, 18, 19]), azar.choice([0, 15, 30, 45]))
        sesiones.append(_sesion(azar, fecha, p, mal_dia, nivel))

    # Una de la versión anterior del equipo, sin hora.
    sesiones.insert(0, _sesion(azar, None, 0.0, False, 1, anterior=True))

    # Una interrumpida que el equipo no pudo analizar (la penúltima).
    archivo, datos, _, _ = sesiones[-2]
    datos.update({"estado": "interrumpida", "fin": "sin_respiracion", "duracion_s": 4.2,
                  "ciclos": None, "resumen": None})
    sesiones[-2] = (archivo, datos, None, False)

    con_csv = {s[0] for s in sesiones[-SESIONES_CON_CSV - 1:] if s[3]}
    for archivo, datos, csv, _ in sesiones:
        guardar_entrenamiento(db, paciente, archivo, datos)
        if csv is not None and archivo in con_csv:
            guardar_csv(db, paciente, archivo, csv)
    return len(sesiones)


def sembrar_si_falta(db: Session) -> None:
    """
    Después de migrar la tabla vieja (app/core/migracion_entrenamientos.py):
    vuelve a cargar las sesiones de ejemplo de Malena, si existe y no tiene ninguna.
    """
    from app.models.entrenamiento import Entrenamiento

    malena = db.query(Paciente).filter(Paciente.nombre_usuario == "msalerno").first()
    if malena is None or db.query(Entrenamiento).filter(Entrenamiento.id_paciente == malena.id_paciente).first():
        return
    sembrar_entrenamientos_demo(db, malena, datetime.now())
    db.commit()
