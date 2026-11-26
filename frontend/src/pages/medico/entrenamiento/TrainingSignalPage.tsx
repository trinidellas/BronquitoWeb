import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Entrenamiento } from '../../../api/types'
import { ApiError, api } from '../../../api/client'
import { useSession } from '../../../auth/session'
import { TrainingViewer } from './TrainingViewer'
import { useSacarDelResumen } from '../useSacarDelResumen'

/**
 * Página del visor de una sesión de entrenamiento, igual que la de
 * evaluaciones (EvaluationSignalPage): sin la ficha ni el listado, con
 * anterior / siguiente / última.
 */
export function TrainingSignalPage() {
  const { idPaciente, idEntrenamiento } = useParams()
  const navigate = useNavigate()
  const { token } = useSession()
  const [entrenamientos, setEntrenamientos] = useState<Entrenamiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !idPaciente) return
    let cancelado = false
    setCargando(true)
    setError(null)
    api.medico
      .entrenamientosDe(token, Number(idPaciente))
      .then((datos) => {
        if (!cancelado) setEntrenamientos(datos)
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : 'No pudimos cargar los entrenamientos.')
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [token, idPaciente])

  // La API los devuelve del más reciente al más viejo (los sin fecha al final).
  const { anterior, siguiente, ultima } = useMemo(() => {
    const indice = entrenamientos.findIndex((e) => e.id_entrenamiento === Number(idEntrenamiento))
    if (indice < 0) return { anterior: null, siguiente: null, ultima: null }
    return {
      anterior: indice < entrenamientos.length - 1 ? entrenamientos[indice + 1] : null,
      siguiente: indice > 0 ? entrenamientos[indice - 1] : null,
      ultima: indice > 0 ? entrenamientos[0] : null,
    }
  }, [entrenamientos, idEntrenamiento])

  const actual = entrenamientos.find((e) => e.id_entrenamiento === Number(idEntrenamiento))
  const sacarDelResumen = useSacarDelResumen(
    token,
    Number(idPaciente),
    'entrenamiento',
    actual ? [actual.id_entrenamiento] : [],
    actual?.oculta ?? false,
    (ids, oculta) => {
      const cuales = new Set(ids)
      setEntrenamientos((lista) => lista.map((e) => (cuales.has(e.id_entrenamiento) ? { ...e, oculta } : e)))
    },
  )

  function irA(destino: Entrenamiento) {
    navigate(`/medico/pacientes/${idPaciente}/entrenamientos/${destino.id_entrenamiento}`)
  }

  if (cargando) return <p className="empty-state">Cargando entrenamiento…</p>
  if (error) return <p className="empty-state">{error}</p>

  return (
    <TrainingViewer
      idPaciente={Number(idPaciente)}
      idEntrenamiento={Number(idEntrenamiento)}
      onVolver={() => navigate(`/?paciente=${idPaciente}&pestana=entrenamiento`)}
      sacarDelResumen={actual ? sacarDelResumen : undefined}
      onAnterior={anterior ? () => irA(anterior) : undefined}
      onSiguiente={siguiente ? () => irA(siguiente) : undefined}
      onUltima={ultima ? () => irA(ultima) : undefined}
    />
  )
}
