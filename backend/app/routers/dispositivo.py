"""
Endpoints que llama la ESP32. Todos exigen el header `X-Device-Key`.

Contrato con el firmware:
  - Los errores vuelven con el código HTTP real y el cuerpo
    `{"ok": false, "error": "texto_sin_acentos"}` (en vez del `{"detail": ...}`
    de FastAPI que usa la web). Eso lo hace `RutaDispositivo`.
  - Ningún texto que viaja a la ESP lleva acentos ni ñ.
  - El PIN nunca viaja del servidor a la ESP: va al revés, la ESP manda lo que
    tipeó el paciente y el servidor dice si coincide.

Orden de una sincronización:
  1. POST /dispositivo/identificar  -> hora + cuántas solicitudes hay.
  2. POST /dispositivo/evaluaciones -> una vez por cada prueba de la SD que
     todavía no subió. Va antes de las solicitudes: un RESET se niega
     mientras haya pruebas sin subir. Lo mismo con los entrenamientos:
     POST /dispositivo/entrenamientos (el JSON) y
     POST /dispositivo/entrenamientos/csv (la señal) por cada sesión.
  3. GET  /dispositivo/solicitudes  -> la cola, en orden.
  4. Por cada una, el paciente toca ACEPTAR / RECHAZAR y la ESP llama a
     POST /dispositivo/solicitudes/{id}/confirmar.
  5. Vuelve a 3 hasta que la lista venga vacía (confirmar un RESET con
     "cambiar usuario" genera el CARGAR_PERFIL siguiente).

Aparte, cuando entra a Configuración y antes de cada entrenamiento (si tiene
conexión), la ESP pide GET /dispositivo/frecuencia: frecuencia, resistencia
y valores predichos. Confirma por separado cada objeto que guardó.
"""

import time
from collections.abc import Callable
from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dispositivo import (
    ErrorDispositivo,
    ahora_utc,
    armar_perfil,
    exigir_clave_dispositivo,
    obtener_dispositivo,
    pin_version,
    registrar,
    sin_acentos,
)
from app.core.entrenamientos_dispositivo import MAX_CSV_BYTES, guardar_csv, guardar_entrenamiento, leer_senal
from app.core.evaluaciones_dispositivo import guardar_prueba
from app.core.predichos import predichos
from app.core.security import verificar_secreto
from app.core.timezone import ARGENTINA, hoy_argentina
from app.models.configuracion_dispositivo import (
    ConfiguracionRepeticiones,
    ConfiguracionResistencia,
    FrecuenciaConfirmada,
)
from app.models.dispositivo import (
    ESTADOS_ACTIVOS,
    Dispositivo,
    EstadoSolicitud,
    SolicitudDispositivo,
    TipoSolicitud,
)
from app.models.frecuencia_recomendada import FrecuenciaRecomendada
from app.models.paciente import Paciente
from app.schemas.dispositivo import (
    ConfirmarFrecuenciaRequest,
    ConfirmarRepeticionesRequest,
    ConfirmarRequest,
    ConfirmarResistenciaRequest,
    IdentificarRequest,
    SubirEvaluacionRequest,
    VerificarPinRequest,
)
from app.schemas.entrenamiento import SubirEntrenamientoRequest


class RutaDispositivo(APIRoute):
    """
    Convierte los errores de estos endpoints al formato que espera la ESP.
    Vive acá (y no como handler global en main.py) para no cambiar cómo
    responde el resto de la API.
    - ErrorDispositivo -> su código y `{"ok": false, "error": ...}`.
    - Body mal armado o con campos inválidos -> 400 "datos_invalidos".
    """

    def get_route_handler(self) -> Callable:
        handler_original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await handler_original(request)
            except ErrorDispositivo as e:
                return JSONResponse(status_code=e.status, content={"ok": False, "error": e.error, **e.extra})
            except RequestValidationError:
                return JSONResponse(status_code=400, content={"ok": False, "error": "datos_invalidos"})

        return handler


router = APIRouter(
    prefix="/dispositivo",
    tags=["dispositivo (ESP)"],
    route_class=RutaDispositivo,
    dependencies=[Depends(exigir_clave_dispositivo)],
)


def _paciente_asignado(dispositivo: Dispositivo, db: Session) -> Paciente | None:
    if dispositivo.id_paciente is None:
        return None
    return db.get(Paciente, dispositivo.id_paciente)


@router.post("/identificar")
def identificar(payload: IdentificarRequest, db: Session = Depends(get_db)):
    """
    La ESP cuenta cómo está. El servidor guarda eso (lo muestra la vista del
    médico) y le devuelve:
      - la hora: la ESP no tiene reloj propio al arrancar.
      - cuántas solicitudes tiene esperando.
      - el usuario asignado y su `pin_version`: si la ESP tiene cargado ese
        usuario pero con otro `pin_version`, es que cambiaron el PIN desde la
        web y tiene que pedirle el nuevo al paciente (verificar-pin).
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()
    dispositivo.vacia = payload.vacia
    dispositivo.usuario_reportado = None if payload.vacia else payload.usuario_actual
    dispositivo.archivos_pendientes = payload.archivos_pendientes
    registrar(
        db, dispositivo, "IDENTIFICAR",
        f"vacia={payload.vacia} usuario={payload.usuario_actual} pendientes={payload.archivos_pendientes}",
    )

    pendientes = (
        db.query(SolicitudDispositivo)
        .filter(
            SolicitudDispositivo.id_dispositivo == dispositivo.id_dispositivo,
            SolicitudDispositivo.estado.in_(ESTADOS_ACTIVOS),
        )
        .count()
    )
    paciente = _paciente_asignado(dispositivo, db)
    db.commit()

    ahora = datetime.now(ARGENTINA)
    return {
        "ok": True,
        "epoch": int(time.time()),
        "offset_minutos": int(ahora.utcoffset().total_seconds() // 60),
        "solicitudes_pendientes": pendientes,
        "usuario": sin_acentos(paciente.nombre_usuario) if paciente else None,
        "pin_version": pin_version(paciente) if paciente else None,
    }


@router.get("/solicitudes")
def listar_solicitudes(db: Session = Depends(get_db)):
    """
    Devuelve, en orden, las solicitudes que la ESP todavía tiene que
    responder: las nuevas (PENDIENTE) y las que ya retiró pero nunca contestó
    (ENTREGADA, ej. se cortó la luz con la pantalla de ACEPTAR abierta). Las
    nuevas pasan a ENTREGADA.

    El perfil de un CARGAR_PERFIL se arma en este momento, así lleva los
    datos más recientes del paciente aunque los haya editado después de
    que se creó la solicitud.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    solicitudes = (
        db.query(SolicitudDispositivo)
        .filter(
            SolicitudDispositivo.id_dispositivo == dispositivo.id_dispositivo,
            SolicitudDispositivo.estado.in_(ESTADOS_ACTIVOS),
        )
        .order_by(SolicitudDispositivo.id_solicitud)
        .all()
    )

    salida = []
    for solicitud in solicitudes:
        if solicitud.tipo == TipoSolicitud.cargar_perfil and solicitud.paciente_destino is not None:
            solicitud.payload = {"perfil": armar_perfil(solicitud.paciente_destino)}
        if solicitud.estado == EstadoSolicitud.pendiente:
            solicitud.estado = EstadoSolicitud.entregada
            solicitud.entregada_en = ahora_utc()
            registrar(db, dispositivo, "ENTREGADA", f"solicitud {solicitud.id_solicitud} {solicitud.tipo.value}")
        salida.append({"id": solicitud.id_solicitud, "tipo": solicitud.tipo.value, "payload": solicitud.payload})

    db.commit()
    return {"ok": True, "solicitudes": salida}


def _aplicar(solicitud: SolicitudDispositivo, dispositivo: Dispositivo, db: Session, cancelada: bool) -> None:
    """Lo que cambia en la base cuando la ESP confirma que APLICÓ una solicitud."""
    if solicitud.tipo == TipoSolicitud.reset:
        dispositivo.vacia = True
        dispositivo.usuario_reportado = None
        dispositivo.archivos_pendientes = 0
        # Si el médico lo había cancelado, el dispositivo igual quedó vacío,
        # pero no le cargamos el reemplazo que ya no quería.
        reemplazo = None if cancelada else solicitud.id_paciente_destino
        dispositivo.id_paciente = reemplazo
        if reemplazo is not None:
            # Recién ahora: así el CARGAR_PERFIL nunca le llega antes que el RESET.
            db.add(SolicitudDispositivo(
                id_dispositivo=dispositivo.id_dispositivo,
                tipo=TipoSolicitud.cargar_perfil,
                estado=EstadoSolicitud.pendiente,
                payload={},
                id_medico=solicitud.id_medico,
                id_paciente_destino=reemplazo,
                creada_en=ahora_utc(),
            ))
            registrar(db, dispositivo, "CARGAR_PERFIL_CREADA", f"reemplazo paciente {reemplazo}", solicitud.id_medico)

    elif solicitud.tipo == TipoSolicitud.cargar_perfil:
        dispositivo.vacia = False
        dispositivo.usuario_reportado = (solicitud.payload.get("perfil") or {}).get("usuario")
        # Si estaba cancelada se había desasignado: el dispositivo tiene ese
        # perfil cargado, así que lo volvemos a asignar (si nadie lo ocupó).
        if dispositivo.id_paciente is None:
            dispositivo.id_paciente = solicitud.id_paciente_destino


@router.post("/solicitudes/{id_solicitud}/confirmar")
def confirmar_solicitud(id_solicitud: int, payload: ConfirmarRequest, db: Session = Depends(get_db)):
    """
    La ESP avisa qué pasó con una solicitud.

    Reglas:
      - Se puede repetir sin problema (si se cortó la luz antes de recibir la
        respuesta): si ya estaba resuelta, contesta 200 con el estado actual.
      - "Si la ESP dice que la aplicó, el servidor le cree": aunque el médico
        la haya cancelado mientras estaba en pantalla, se registra lo que
        realmente pasó en el dispositivo.
      - Un error no se reintenta solo: el médico la vuelve a pedir.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    solicitud = db.get(SolicitudDispositivo, id_solicitud)
    if solicitud is None or solicitud.id_dispositivo != dispositivo.id_dispositivo:
        raise ErrorDispositivo(404, "solicitud_inexistente")

    finales = (EstadoSolicitud.confirmada, EstadoSolicitud.rechazada, EstadoSolicitud.error)
    if solicitud.estado in finales:
        db.commit()
        return {"ok": True, "estado": solicitud.estado.value}

    cancelada = solicitud.estado == EstadoSolicitud.cancelada
    solicitud.detalle = payload.detalle
    solicitud.confirmada_en = ahora_utc()

    if payload.ok:
        _aplicar(solicitud, dispositivo, db, cancelada)
        solicitud.estado = EstadoSolicitud.confirmada
        if cancelada:
            solicitud.detalle = "aplicada despues de cancelada"
    elif not cancelada:
        rechazada = payload.detalle == "rechazado_por_usuario"
        solicitud.estado = EstadoSolicitud.rechazada if rechazada else EstadoSolicitud.error
        # Un perfil que no se cargó deja el dispositivo libre otra vez.
        if (
            solicitud.tipo == TipoSolicitud.cargar_perfil
            and dispositivo.id_paciente == solicitud.id_paciente_destino
        ):
            dispositivo.id_paciente = None

    registrar(
        db, dispositivo, "CONFIRMAR",
        f"solicitud {solicitud.id_solicitud} {solicitud.tipo.value} ok={payload.ok} "
        f"detalle={payload.detalle} -> {solicitud.estado.value}",
    )
    db.commit()
    return {"ok": True, "estado": solicitud.estado.value}


# --- PIN ----------------------------------------------------------------------


@router.post("/verificar-pin")
def verificar_pin(payload: VerificarPinRequest, db: Session = Depends(get_db)):
    """
    La ESP manda el PIN que tipeó el paciente y el servidor lo compara contra
    el hash guardado. Si coincide, la ESP lo guarda y lo usa offline.

    Sólo se puede verificar el PIN del paciente asignado al dispositivo (no
    sirve para probar PINs de cualquier usuario). Sin límite de intentos, igual
    que el login de pacientes (ver app/core/security.py).
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    paciente = _paciente_asignado(dispositivo, db)
    if paciente is None:
        db.commit()
        raise ErrorDispositivo(404, "sin_paciente_asignado")
    if payload.usuario != sin_acentos(paciente.nombre_usuario):
        db.commit()
        raise ErrorDispositivo(404, "usuario_no_asignado")

    if not verificar_secreto(payload.pin, paciente.pin_hash):
        registrar(db, dispositivo, "PIN_INCORRECTO")
        db.commit()
        raise ErrorDispositivo(401, "pin_incorrecto")

    # Se anota la versión: así la vista del paciente sabe si el dispositivo
    # ya tiene su PIN actual (ver app/routers/dispositivo_paciente.py).
    registrar(db, dispositivo, "PIN_OK", pin_version(paciente))
    db.commit()
    return {"ok": True, "pin_version": pin_version(paciente)}


# --- Pruebas de la SD -----------------------------------------------------------


@router.post("/evaluaciones")
def subir_evaluacion(payload: SubirEvaluacionRequest, db: Session = Depends(get_db)):
    """
    La ESP sube una prueba de /EVALUACIONES de su SD (el `.json` y el texto
    del `.csv`). Con 200 la marca `"sincronizado": true` y no la vuelve a mandar.

    Reglas:
      - Sólo pruebas del paciente asignado al dispositivo (igual que verificar-pin).
      - Se puede repetir sin problema: si la prueba ya había llegado, contesta
        200 con `"estado": "repetida"` y no la duplica.
      - Las que no se muestran en la web (espirometría inválida, PIM en cero)
        igual se guardan y contestan 200, así la ESP deja de tenerlas pendientes.
    La conversión al formato de la web está en app/core/evaluaciones_dispositivo.py.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    paciente = _paciente_asignado(dispositivo, db)
    if paciente is None:
        db.commit()
        raise ErrorDispositivo(404, "sin_paciente_asignado")
    if payload.usuario != sin_acentos(paciente.nombre_usuario):
        db.commit()
        raise ErrorDispositivo(404, "usuario_no_asignado")

    resultado = guardar_prueba(db, paciente, payload.archivo, payload.resumen, payload.csv)
    registrar(
        db, dispositivo, "PRUEBA_RECIBIDA",
        f"{payload.archivo} -> {resultado['estado']} visible={resultado['visible']} "
        f"evaluacion={resultado['id_evaluacion']}",
    )
    db.commit()
    return {"ok": True, **resultado}


# --- Configuración: frecuencia, resistencia y predichos ---------------------------


def _paciente_del_pedido(usuario: str, dispositivo: Dispositivo, db: Session) -> Paciente:
    """Como en verificar-pin: sólo se responde por el paciente asignado."""
    paciente = _paciente_asignado(dispositivo, db)
    if paciente is None:
        db.commit()
        raise ErrorDispositivo(404, "sin_paciente_asignado")
    if usuario != sin_acentos(paciente.nombre_usuario):
        db.commit()
        raise ErrorDispositivo(404, "usuario_no_asignado")
    return paciente


@router.get("/frecuencia")
def configuracion(usuario: str, db: Session = Depends(get_db)):
    """
    Lo que el equipo guarda para entrenar. Objetos independientes (el equipo
    guarda y confirma cada uno por separado):
      - "frecuencia": la vigente hoy (la última que fijó el médico).
      - "resistencia_web": modo y nivel manual que fijó el médico.
      - "repeticiones": cuántas respiraciones pide en cada sesión.
      - "predichos": FVC y PIM predichas, recalculadas en cada pedido.
    "frecuencia", "resistencia_web" y "repeticiones" se omiten si el médico
    todavía no las fijó (sin "resistencia_web" el equipo usa el modo
    automático; sin "repeticiones", las suyas). En "predichos", el valor que
    no se pueda calcular va en null.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()
    paciente = _paciente_del_pedido(usuario, dispositivo, db)

    respuesta: dict = {"ok": True}

    frecuencia = (
        db.query(FrecuenciaRecomendada)
        .filter(
            FrecuenciaRecomendada.id_paciente == paciente.id_paciente,
            FrecuenciaRecomendada.vigente_desde <= hoy_argentina(),
        )
        .order_by(FrecuenciaRecomendada.vigente_desde.desc(), FrecuenciaRecomendada.id_frecuencia.desc())
        .first()
    )
    if frecuencia is not None:
        respuesta["frecuencia"] = {
            "id": frecuencia.id_frecuencia,
            "sesiones_por_semana": frecuencia.sesiones_por_semana,
            "dias_semana": sorted(frecuencia.dias_semana),
            "vigente_desde": frecuencia.vigente_desde.isoformat(),
        }

    resistencia = (
        db.query(ConfiguracionResistencia)
        .filter(ConfiguracionResistencia.id_paciente == paciente.id_paciente)
        .order_by(ConfiguracionResistencia.id_resistencia.desc())
        .first()
    )
    if resistencia is not None:
        respuesta["resistencia_web"] = {
            "id": resistencia.id_resistencia,
            "modo": resistencia.modo,
            "nivel_manual": resistencia.nivel_manual,
            "enviado": resistencia.enviado.isoformat(),
        }

    repeticiones = (
        db.query(ConfiguracionRepeticiones)
        .filter(ConfiguracionRepeticiones.id_paciente == paciente.id_paciente)
        .order_by(ConfiguracionRepeticiones.id_repeticiones.desc())
        .first()
    )
    if repeticiones is not None:
        respuesta["repeticiones"] = {
            "id": repeticiones.id_repeticiones,
            "repeticiones": repeticiones.repeticiones,
            "enviado": repeticiones.enviado.isoformat(),
        }

    respuesta["predichos"] = predichos(paciente, db)

    registrar(
        db, dispositivo, "CONFIGURACION",
        f"frecuencia={frecuencia.id_frecuencia if frecuencia else None} "
        f"resistencia={resistencia.id_resistencia if resistencia else None} "
        f"repeticiones={repeticiones.id_repeticiones if repeticiones else None} {respuesta['predichos']}",
    )
    db.commit()
    return respuesta


@router.post("/frecuencia/confirmar")
def confirmar_frecuencia(payload: ConfirmarFrecuenciaRequest, db: Session = Depends(get_db)):
    """
    El equipo guardó esa frecuencia. Siempre contesta 200 (el equipo no lee
    la respuesta): si el id no existe, se anota y listo, así el equipo no se
    queda reintentando. Repetirlo no cambia nada.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    existe = db.get(FrecuenciaRecomendada, payload.id_frecuencia) is not None
    if existe and db.get(FrecuenciaConfirmada, payload.id_frecuencia) is None:
        db.add(FrecuenciaConfirmada(id_frecuencia=payload.id_frecuencia, confirmada_en=ahora_utc()))
    registrar(db, dispositivo, "FRECUENCIA_OK", f"frecuencia {payload.id_frecuencia} existe={existe}")
    db.commit()
    return {"ok": True, "registrada": existe}


@router.post("/resistencia/confirmar")
def confirmar_resistencia(payload: ConfirmarResistenciaRequest, db: Session = Depends(get_db)):
    """Igual que confirmar_frecuencia, para "resistencia_web"."""
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    resistencia = db.get(ConfiguracionResistencia, payload.id_resistencia)
    if resistencia is not None and resistencia.confirmada_en is None:
        resistencia.confirmada_en = ahora_utc()
    registrar(
        db, dispositivo, "RESISTENCIA_OK", f"resistencia {payload.id_resistencia} existe={resistencia is not None}",
    )
    db.commit()
    return {"ok": True, "registrada": resistencia is not None}


@router.post("/repeticiones/confirmar")
def confirmar_repeticiones(payload: ConfirmarRepeticionesRequest, db: Session = Depends(get_db)):
    """Igual que confirmar_frecuencia, para "repeticiones"."""
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()

    repeticiones = db.get(ConfiguracionRepeticiones, payload.id_repeticiones)
    if repeticiones is not None and repeticiones.confirmada_en is None:
        repeticiones.confirmada_en = ahora_utc()
    registrar(
        db, dispositivo, "REPETICIONES_OK",
        f"repeticiones {payload.id_repeticiones} existe={repeticiones is not None}",
    )
    db.commit()
    return {"ok": True, "registrada": repeticiones is not None}


# --- Entrenamientos de la SD ------------------------------------------------------


@router.post("/entrenamientos")
def subir_entrenamiento(payload: SubirEntrenamientoRequest, db: Session = Depends(get_db)):
    """
    El JSON de una sesión de entrenamiento. Se guarda completo, tal como
    llega. Si ya había llegado una sesión con ese `archivo`, se reemplaza.
    La señal va aparte (POST /dispositivo/entrenamientos/csv), antes o después.
    """
    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()
    paciente = _paciente_del_pedido(payload.usuario, dispositivo, db)

    resultado = guardar_entrenamiento(db, paciente, payload.archivo, payload.resumen)
    registrar(
        db, dispositivo, "ENTRENAMIENTO_RECIBIDO",
        f"{payload.archivo} -> {resultado['estado']} id={resultado['id_entrenamiento']} "
        f"senal={resultado['senal_recibida']}",
    )
    db.commit()
    return {"ok": True, **resultado}


@router.post("/entrenamientos/csv")
async def subir_csv_entrenamiento(
    request: Request, usuario: str, archivo: str, db: Session = Depends(get_db),
):
    """
    La señal cruda de una sesión: el cuerpo es el CSV tal cual (text/csv,
    `tiempo_ms,presion_cmh2o,flujo_lmin,v_flujo_v,v_pim_v`). Se guarda por
    `archivo`: puede llegar antes que el JSON o repetida (se reemplaza).
    400 si está vacío, no es texto, no tiene ninguna muestra o pesa demasiado.
    """
    if not (1 <= len(archivo) <= 80) or len(usuario) > 25:
        raise ErrorDispositivo(400, "datos_invalidos")
    cuerpo = await request.body()
    if not cuerpo or len(cuerpo) > MAX_CSV_BYTES:
        raise ErrorDispositivo(400, "datos_invalidos")
    try:
        csv = cuerpo.decode("utf-8")
    except UnicodeDecodeError:
        raise ErrorDispositivo(400, "datos_invalidos") from None
    if leer_senal(csv) is None:
        raise ErrorDispositivo(400, "datos_invalidos")

    dispositivo = obtener_dispositivo(db)
    dispositivo.ultimo_contacto = ahora_utc()
    paciente = _paciente_del_pedido(usuario, dispositivo, db)

    resultado = guardar_csv(db, paciente, archivo, csv)
    registrar(
        db, dispositivo, "ENTRENAMIENTO_CSV_RECIBIDO",
        f"{archivo} -> {resultado['estado']} ({len(cuerpo)} bytes) "
        f"entrenamiento={resultado['id_entrenamiento']}",
    )
    db.commit()
    return {"ok": True, **resultado}
