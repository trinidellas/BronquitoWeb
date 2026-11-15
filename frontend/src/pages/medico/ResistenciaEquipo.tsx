import { useEffect, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { apiResistencia } from '../../api/resistencia'
import type { ConfiguracionEquipo, ModoResistencia } from '../../api/resistencia'

interface ResistenciaTagProps {
  token: string
  idPaciente: number
  nombrePaciente: string
}

const NIVELES = [1, 2, 3, 4, 5]

function textoTag(config: ConfiguracionEquipo | null): string {
  if (!config) return 'Modo de resistencia: …'
  const r = config.resistencia
  if (!r || r.modo === 'automatico') return 'Modo de resistencia: automático'
  return `Modo de resistencia: manual (nivel ${r.nivel_manual})`
}

/**
 * Tag de la ficha del paciente: muestra cómo está fijada la resistencia de la
 * válvula y, al tocarlo, abre el modal para cambiarla.
 */
export function ResistenciaTag({ token, idPaciente, nombrePaciente }: ResistenciaTagProps) {
  const [config, setConfig] = useState<ConfiguracionEquipo | null>(null)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    let vigente = true
    apiResistencia
      .ver(token, idPaciente)
      .then((c) => vigente && setConfig(c))
      .catch(() => vigente && setConfig(null))
    return () => {
      vigente = false
    }
  }, [token, idPaciente])

  const pendiente = config?.resistencia != null && config.resistencia.confirmada_en == null

  return (
    <>
      <button
        className="tag tag-clickable"
        onClick={() => setAbierto(true)}
        title={pendiente ? 'Todavía no llegó al equipo' : 'Modificar resistencia'}
      >
        {textoTag(config)}
        {pendiente && <span className="resistencia-pendiente" aria-label="sin sincronizar" />}
      </button>
      {abierto && (
        <ResistenciaModal
          token={token}
          idPaciente={idPaciente}
          nombrePaciente={nombrePaciente}
          configInicial={config}
          onCambio={setConfig}
          onClose={() => setAbierto(false)}
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
