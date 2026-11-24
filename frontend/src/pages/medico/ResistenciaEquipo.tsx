import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { REPETICIONES_MAX, REPETICIONES_MIN, apiResistencia } from '../../api/resistencia'
import type { ConfiguracionEquipo, ModoResistencia } from '../../api/resistencia'

interface TagsEquipoProps {
  token: string
  idPaciente: number
  nombrePaciente: string
}

const NIVELES = [1, 2, 3, 4, 5]
/** Lo que se propone en el modal si el médico todavía no fijó ninguna. */
const REPETICIONES_SUGERIDAS = 30
/** Cada cuánto se vuelve a preguntar si el equipo ya confirmó, mientras haya algo pendiente. */
const INTERVALO_REVISAR_MS = 30_000

function textoTagResistencia(config: ConfiguracionEquipo | null): string {
  if (!config) return 'Modo de resistencia: …'
  const r = config.resistencia
  if (!r || r.modo === 'automatico') return 'Modo de resistencia: automático'
  return `Modo de resistencia: manual (nivel ${r.nivel_manual})`
}

function textoTagRepeticiones(config: ConfiguracionEquipo | null): string {
  if (!config) return 'Repeticiones: …'
  const r = config.repeticiones
  return r ? `Repeticiones: ${r.repeticiones} por sesión` : 'Repeticiones: sin definir'
}

/**
 * Tags de la ficha del paciente con lo que viaja al equipo cuando sincroniza:
 * cómo se fija la resistencia de la válvula y cuántas repeticiones pide en
 * cada sesión. Cada uno abre su modal para cambiarlo, y muestra un punto
 * amarillo hasta que el equipo confirma que lo guardó.
 */
export function TagsEquipo({ token, idPaciente, nombrePaciente }: TagsEquipoProps) {
  const [config, setConfig] = useState<ConfiguracionEquipo | null>(null)
  const [abierto, setAbierto] = useState<'resistencia' | 'repeticiones' | null>(null)
  // Sube con cada pedido y con cada cambio guardado: así una respuesta que
  // llega tarde no pisa algo más nuevo (ej. lo que se acaba de guardar).
  const versionRef = useRef(0)

  const cargar = useCallback(
    (primeraVez: boolean) => {
      const esta = ++versionRef.current
      apiResistencia
        .ver(token, idPaciente)
        .then((c) => {
          if (esta === versionRef.current) setConfig(c)
        })
        .catch(() => {
          // Si falla al recargar, se queda lo último que se vio.
          if (primeraVez && esta === versionRef.current) setConfig(null)
        })
    },
    [token, idPaciente],
  )

  // Al cambiar de paciente, el pedido nuevo sube la versión: lo que llegue
  // tarde del paciente anterior se descarta.
  useEffect(() => {
    cargar(true)
  }, [cargar])

  /** Lo que devuelve el servidor al guardar en un modal. */
  const cambio = useCallback((nueva: ConfiguracionEquipo) => {
    versionRef.current++
    setConfig(nueva)
  }, [])

  const resistenciaPendiente = config?.resistencia != null && config.resistencia.confirmada_en == null
  const repeticionesPendientes = config?.repeticiones != null && config.repeticiones.confirmada_en == null
  const hayPendiente = resistenciaPendiente || repeticionesPendientes

  // El equipo confirma cuando sincroniza, que puede ser con la ficha abierta:
  // se vuelve a preguntar al volver a la pestaña y, mientras haya algo
  // pendiente, cada INTERVALO_REVISAR_MS. Así el punto amarillo se va solo.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar(false)
    }
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    const intervalo = hayPendiente ? window.setInterval(() => cargar(false), INTERVALO_REVISAR_MS) : undefined
    return () => {
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
      if (intervalo !== undefined) window.clearInterval(intervalo)
    }
  }, [cargar, hayPendiente])

  return (
    <>
      <button
        className="tag tag-clickable"
        onClick={() => setAbierto('resistencia')}
        title={resistenciaPendiente ? 'Todavía no llegó al equipo' : 'Modificar resistencia'}
      >
        {textoTagResistencia(config)}
        {resistenciaPendiente && <span className="resistencia-pendiente" aria-label="sin sincronizar" />}
      </button>
      <button
        className="tag tag-clickable"
        onClick={() => setAbierto('repeticiones')}
        title={repeticionesPendientes ? 'Todavía no llegó al equipo' : 'Modificar repeticiones'}
      >
        {textoTagRepeticiones(config)}
        {repeticionesPendientes && <span className="resistencia-pendiente" aria-label="sin sincronizar" />}
      </button>
      {abierto === 'resistencia' && (
        <ResistenciaModal
          token={token}
          idPaciente={idPaciente}
          nombrePaciente={nombrePaciente}
          configInicial={config}
          onCambio={cambio}
          onClose={() => setAbierto(null)}
        />
      )}
      {abierto === 'repeticiones' && (
        <RepeticionesModal
          token={token}
          idPaciente={idPaciente}
          nombrePaciente={nombrePaciente}
          configInicial={config}
          onCambio={cambio}
          onClose={() => setAbierto(null)}
        />
      )}
    </>
  )
}

interface ResistenciaModalProps {
  token: string
  idPaciente: number
  nombrePaciente: string
  configInicial: ConfiguracionEquipo | null
  onCambio: (config: ConfiguracionEquipo) => void
  onClose: () => void
}

function ResistenciaModal({ token, idPaciente, nombrePaciente, configInicial, onCambio, onClose }: ResistenciaModalProps) {
  const [config, setConfig] = useState(configInicial)
  const [modo, setModo] = useState<ModoResistencia>(configInicial?.resistencia?.modo ?? 'automatico')
  const [nivel, setNivel] = useState(configInicial?.resistencia?.nivel_manual ?? 3)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const r = config?.resistencia
  const sinCambios = r != null && r.modo === modo && (modo === 'automatico' || r.nivel_manual === nivel)

  function actualizar(nueva: ConfiguracionEquipo) {
    setConfig(nueva)
    onCambio(nueva)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      actualizar(await apiResistencia.fijar(token, idPaciente, modo, nivel))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar el cambio.')
      setGuardando(false)
    }
  }

  async function elegirEcuacion(sexo: 'M' | 'F') {
    setError(null)
    try {
      actualizar(await apiResistencia.elegirEcuacion(token, idPaciente, sexo))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar la ecuación.')
    }
  }

  const p = config?.predichos
  return (
    <Modal
      titulo="Resistencia de la válvula"
      onClose={onClose}
      wide
      acciones={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button className="btn btn-teal" onClick={guardar} disabled={guardando || sinCambios}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <p>
        Elegí cómo se fija la resistencia del equipo de {nombrePaciente} (1 = más abierta, 5 = más cerrada).
        El cambio llega al equipo la próxima vez que se conecte.
      </p>

      <div className="field">
        <label id="modo-label">Modo</label>
        <div className="freq-picker" role="radiogroup" aria-labelledby="modo-label">
          {(['automatico', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              className={`freq-option ${modo === m ? 'active' : ''}`}
              onClick={() => setModo(m)}
            >
              {m === 'automatico' ? 'Automático' : 'Manual'}
            </button>
          ))}
        </div>
        <p className="resistencia-ayuda">
          {modo === 'automatico'
            ? 'El equipo calcula el nivel después de cada evaluación. Para entrenar pide una evaluación de los últimos 15 días.'
            : 'El equipo usa siempre el nivel que elijas. No pide evaluación vigente.'}
        </p>
      </div>

      {modo === 'manual' && (
        <div className="field">
          <label id="nivel-label">Nivel</label>
          <div className="freq-picker" role="radiogroup" aria-labelledby="nivel-label">
            {NIVELES.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={nivel === n}
                className={`freq-option ${nivel === n ? 'active' : ''}`}
                onClick={() => setNivel(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>Valores predichos (para el modo automático)</label>
        {config?.sexo === 'X' && (
          <>
            <p className="resistencia-ayuda">
              El sexo del paciente es "X": elegí qué ecuación usar para calcular los predichos.
            </p>
            <div className="freq-picker" role="radiogroup" aria-label="Ecuación de los predichos">
              {(['F', 'M'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={config.sexo_ecuacion === s}
                  className={`freq-option ${config.sexo_ecuacion === s ? 'active' : ''}`}
                  onClick={() => elegirEcuacion(s)}
                >
                  {s === 'F' ? 'Mujer' : 'Hombre'}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="resistencia-ayuda">
          FVC predicha (GLI Global 2022): <strong>{p?.fvc_predicha_L != null ? `${p.fvc_predicha_L} L` : 'no disponible'}</strong>
          {' · '}
          PIM predicha (Evans y Whitelaw): <strong>{p?.pim_predicha_cmh2o != null ? `${p.pim_predicha_cmh2o} cmH₂O` : 'no disponible'}</strong>
        </p>
      </div>

      {r && (
        <p className="resistencia-ayuda">
          {r.confirmada_en
            ? 'El equipo ya tiene la configuración actual.'
            : 'La configuración actual todavía no llegó al equipo.'}
        </p>
      )}
      {error && <div className="auth-alert error">{error}</div>}
    </Modal>
  )
}

/** Cuántas repeticiones (respiraciones contra la válvula) pide el equipo en cada sesión de entrenamiento. */
function RepeticionesModal({ token, idPaciente, nombrePaciente, configInicial, onCambio, onClose }: ResistenciaModalProps) {
  const actual = configInicial?.repeticiones
  const [texto, setTexto] = useState(String(actual?.repeticiones ?? REPETICIONES_SUGERIDAS))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valor = Number(texto)
  const valido = Number.isInteger(valor) && valor >= REPETICIONES_MIN && valor <= REPETICIONES_MAX
  const sinCambios = actual != null && valor === actual.repeticiones

  function sumar(delta: number) {
    const base = valido ? valor : actual?.repeticiones ?? REPETICIONES_SUGERIDAS
    setTexto(String(Math.min(REPETICIONES_MAX, Math.max(REPETICIONES_MIN, base + delta))))
  }

  async function guardar() {
    if (!valido) return
    setGuardando(true)
    setError(null)
    try {
      onCambio(await apiResistencia.fijarRepeticiones(token, idPaciente, valor))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar el cambio.')
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Repeticiones por sesión"
      onClose={onClose}
      acciones={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button className="btn btn-teal" onClick={guardar} disabled={guardando || !valido || sinCambios}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <p>
        Cuántas repeticiones (respiraciones contra la válvula) tiene que hacer {nombrePaciente} en cada sesión de
        entrenamiento. El cambio llega al equipo la próxima vez que se conecte.
      </p>

      <div className="field">
        <label htmlFor="repeticiones-input">Repeticiones</label>
        <div className="repeticiones-stepper">
          <button
            type="button"
            className="freq-option"
            onClick={() => sumar(-1)}
            disabled={valido && valor <= REPETICIONES_MIN}
            aria-label="Una repetición menos"
          >
            −
          </button>
          {/* Texto y no "number": así sólo entran dígitos (ni "-", ni coma, ni la "e" que acepta un number). */}
          <input
            id="repeticiones-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void guardar()
            }}
          />
          <button
            type="button"
            className="freq-option"
            onClick={() => sumar(1)}
            disabled={valido && valor >= REPETICIONES_MAX}
            aria-label="Una repetición más"
          >
            +
          </button>
        </div>
        {!valido && (
          <p className="field-hint">
            Tiene que ser un número entero entre {REPETICIONES_MIN} y {REPETICIONES_MAX}.
          </p>
        )}
      </div>

      {actual && (
        <p className="resistencia-ayuda">
          {actual.confirmada_en
            ? `El equipo ya tiene las ${actual.repeticiones} repeticiones actuales.`
            : `Las ${actual.repeticiones} repeticiones actuales todavía no llegaron al equipo.`}
        </p>
      )}
      {error && <div className="auth-alert error">{error}</div>}
    </Modal>
  )
}
