import type { Entrenamiento, EntrenamientoConFecha } from '../../../api/types'

/**
 * Cómo se muestran los datos de un entrenamiento. Todas las pantallas
 * (lista, visor, evolución, PDF) pasan por acá, así las convenciones son las
 * mismas en todos lados:
 *   - Un número en null ("no se pudo calcular") se muestra "--", nunca 0.
 *   - PIM y PEM con la convención clínica: el equipo manda la PIM positiva y
 *     la PEM negativa; se muestran -pim (negativa) y -pem (positiva).
 *   - La caída de la PIM y su pendiente se muestran como vienen.
 */

export const SIN_DATO = '--'

/** 12.345 -> "12,3" (con `decimales`); null -> "--". */
export function num(valor: number | null | undefined, decimales = 1, unidad?: string): string {
  if (valor == null || !Number.isFinite(valor)) return SIN_DATO
  const texto = valor.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return unidad ? `${texto} ${unidad}` : texto
}

/** PIM con la convención clínica (negativa). */
export function pimClinica(valor: number | null | undefined): number | null {
  return valor == null ? null : -valor
}

/** PEM con la convención clínica (positiva). */
export function pemClinica(valor: number | null | undefined): number | null {
  return valor == null ? null : -valor
}

/** 83.4 -> "1:23". */
export function duracion(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos)) return SIN_DATO
  const total = Math.round(segundos)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "14 nov 2026, 15:30", o "Sin fecha". */
export function fecha(e: Pick<Entrenamiento, 'fecha_hora'>, conHora = true): string {
  if (!e.fecha_hora) return 'Sin fecha'
  const d = new Date(e.fecha_hora)
  const dia = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
  return conHora ? `${dia}, ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : dia
}

export const TEXTO_ESTADO: Record<NonNullable<Entrenamiento['estado']>, string> = {
  completa: 'Completa',
  incompleta: 'Incompleta',
  interrumpida: 'Interrumpida',
}

export const TEXTO_FIN: Record<NonNullable<Entrenamiento['fin']>, string> = {
  objetivo: 'Llegó al objetivo de ciclos',
  detenida: 'La detuvo el paciente',
  sin_respiracion: 'Se cortó: sin respiración',
  tiempo_maximo: 'Se cortó: tiempo máximo',
}

export function estado(e: Entrenamiento): string {
  return e.estado ? TEXTO_ESTADO[e.estado] : SIN_DATO
}

export function finTexto(e: Entrenamiento): string {
  return e.fin ? TEXTO_FIN[e.fin] : SIN_DATO
}

export function modo(e: Entrenamiento): string {
  if (e.modo_resistencia === 'automatico') return 'automático'
  if (e.modo_resistencia === 'manual') return 'manual'
  return SIN_DATO
}

/** "Nivel 3 (automático)". */
export function resistencia(e: Entrenamiento): string {
  if (e.nivel_resistencia == null) return SIN_DATO
  return e.modo_resistencia ? `Nivel ${e.nivel_resistencia} (${modo(e)})` : `Nivel ${e.nivel_resistencia}`
}

/** "4/30": ciclos completos sobre el objetivo. */
export function ciclosHechos(e: Entrenamiento): string {
  return `${e.n_ciclos_completos ?? SIN_DATO}/${e.ciclos_objetivo ?? SIN_DATO}`
}

/** " (ciclo 3)", o nada si no se sabe en qué ciclo. */
export function enCiclo(numero: number | null | undefined): string {
  return numero != null ? ` (ciclo ${numero})` : ''
}

export function conFecha(e: Entrenamiento): e is EntrenamientoConFecha {
  return e.fecha_hora != null
}

/**
 * Reduce una señal larga a lo sumo a `maxPuntos` puntos sin perder los
 * picos: por cada ventana se queda con el mínimo y el máximo, en el orden en
 * que aparecen. Los huecos (null) se conservan: si una ventana tiene alguno,
 * queda un null en su lugar, así la línea se sigue cortando ahí.
 */
export function reducirSerie(
  x: number[],
  y: (number | null)[],
  maxPuntos = 1600,
): { x: number[]; y: (number | null)[] } {
  const ventanas = Math.floor(maxPuntos / 2)
  if (x.length <= maxPuntos || ventanas < 1) return { x, y }
  const tamano = x.length / ventanas
  const rx: number[] = []
  const ry: (number | null)[] = []
  for (let v = 0; v < ventanas; v++) {
    const desde = Math.floor(v * tamano)
    const hasta = Math.min(Math.floor((v + 1) * tamano), x.length)
    let iMin = -1
    let iMax = -1
    let iHueco = -1
    for (let i = desde; i < hasta; i++) {
      const valor = y[i]
      if (valor == null) {
        if (iHueco < 0) iHueco = i
        continue
      }
      if (iMin < 0 || valor < (y[iMin] as number)) iMin = i
      if (iMax < 0 || valor > (y[iMax] as number)) iMax = i
    }
    const elegidos = [...new Set([iMin, iMax, iHueco].filter((i) => i >= 0))].sort((a, b) => a - b)
    for (const i of elegidos) {
      if (rx.length === 0 || rx[rx.length - 1] !== x[i]) {
        rx.push(x[i])
        ry.push(y[i])
      }
    }
  }
  return { x: rx, y: ry }
}
