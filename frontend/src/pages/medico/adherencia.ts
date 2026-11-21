import type { Adherencia } from '../../types'
import { isoArgentina } from '../../data/mockData'

/**
 * Adherencia de un paciente en la lista del médico, a partir de su última
 * sesión (la evaluación o el entrenamiento más reciente, ver
 * `GET /medicos/me/pacientes`). Se cuenta por día de calendario, igual que
 * el calendario del paciente: la fecha de la sesión es la que trae
 * `fecha_hora` (YYYY-MM-DD…) y hoy es hoy en Argentina.
 */

/** Días de calendario entre la sesión y hoy (0 = hoy). Null si no hay sesión. */
export function diasDesdeUltimaSesion(ultimaSesion: string | null | undefined, hoy = new Date()): number | null {
  if (!ultimaSesion) return null
  const [anio, mes, dia] = ultimaSesion.slice(0, 10).split('-').map(Number)
  const [anioHoy, mesHoy, diaHoy] = isoArgentina(hoy).split('-').map(Number)
  const dias = Math.round((Date.UTC(anioHoy, mesHoy - 1, diaHoy) - Date.UTC(anio, mes - 1, dia)) / 86_400_000)
  return Number.isFinite(dias) ? Math.max(0, dias) : null
}

/** Verde hasta 2 días, ámbar de 3 a 6, rojo desde 7 o sin sesiones. */
export function adherenciaDe(ultimaSesion: string | null | undefined): Adherencia {
  const dias = diasDesdeUltimaSesion(ultimaSesion)
  if (dias == null) return 'sin_actividad'
  if (dias <= 2) return 'buena'
  if (dias <= 6) return 'irregular'
  return 'sin_actividad'
}

export function textoUltimaSesion(ultimaSesion: string | null | undefined): string {
  const dias = diasDesdeUltimaSesion(ultimaSesion)
  if (dias == null) return 'Sin sesiones aún'
  if (dias === 0) return 'Última sesión: hoy'
  if (dias === 1) return 'Última sesión: ayer'
  return `Última sesión: hace ${dias} días`
}
