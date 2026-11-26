import { useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { EstadoOculta } from './SacarDelResumen'

/**
 * El botón "Sacar del resumen" de los visores: marca (o desmarca) esas
 * mediciones como fallidas, igual que el ojito de las tablas de la ficha. Se
 * ve al toque (`aplicar`) y, si el servidor no lo guarda, vuelve como estaba.
 */
export function useSacarDelResumen(
  token: string | null,
  idPaciente: number,
  tipo: 'evaluacion' | 'entrenamiento',
  ids: number[],
  oculta: boolean,
  aplicar: (ids: number[], oculta: boolean) => void,
): EstadoOculta {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cambiar() {
    if (!token || ids.length === 0 || guardando) return
    const nueva = !oculta
    setError(null)
    setGuardando(true)
    aplicar(ids, nueva)
    try {
      await api.medico.ocultarMediciones(token, idPaciente, tipo, ids, nueva)
    } catch (err) {
      aplicar(ids, oculta)
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return { oculta, guardando, error, cambiar: () => void cambiar() }
}
