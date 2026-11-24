import type { Entrenamiento, EntrenamientoConFecha } from '../../../api/types'

/**
 * Cómo se muestran los datos de un entrenamiento. Todas las pantallas
 * (lista, visor, evolución, PDF) pasan por acá, así las convenciones son las
 * mismas en todos lados:
 *   - Un número en null ("no se pudo calcular") se muestra "--", nunca 0.
 *   - Signos: el equipo manda la inspiración en negativo (presión y flujo).
 *     Las sesiones de antes traían la presión y la PIM positivas al
 *     inspirar. Para que se vea igual venga como venga:
 *       - PIM siempre negativa y PEM siempre positiva (convención clínica);
 *       - PIF y PEF como magnitud (positivos);
 *       - la curva de presión se da vuelta si la sesión la trae positiva al
 *         inspirar (ver `presionPositivaAlInspirar`).
 *   - La caída de la PIM se muestra como viene (> 0 = cayó); su pendiente,
 *     en la misma convención que la PIM que se muestra.
 */

export const SIN_DATO = '--'

/** 12.345 -> "12,3" (con `decimales`); null -> "--". */
export function num(valor: number | null | undefined, decimales = 1, unidad?: string): string {
  if (valor == null || !Number.isFinite(valor)) return SIN_DATO
  const texto = valor.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return unidad ? `${texto} ${unidad}` : texto
}

/** PIM con la convención clínica (negativa), venga con el signo que venga del equipo. */
export function pimClinica(valor: number | null | undefined): number | null {
  // `0 -` y no `-`: así un 0 no se muestra "-0".
  return valor == null ? null : 0 - Math.abs(valor)
}

/** PEM con la convención clínica (positiva), venga con el signo que venga del equipo. */
export function pemClinica(valor: number | null | undefined): number | null {
  return valor == null ? null : Math.abs(valor)
}

/** PIF y PEF como magnitud (positivos), vengan con el signo que vengan del equipo. */
export function picoFlujo(valor: number | null | undefined): number | null {
  return valor == null ? null : Math.abs(valor)
}

/**
 * La pendiente de la PIM (cmH₂O por ciclo) en la misma convención que la
 * PIM que se muestra (negativa). El equipo la calcula sobre la PIM con su
 * propio signo: si mandó la PIM positiva (formato viejo), va al revés.
 */
export function pendientePimClinica(
  pendiente: number | null | undefined,
  pimDelEquipo: number | null | undefined,
): number | null {
  if (pendiente == null) return null
  return pimDelEquipo != null && pimDelEquipo > 0 ? 0 - pendiente : pendiente
}

function masCercano(tiempo: number[], t: number): number {
  let izquierda = 0
  let derecha = tiempo.length - 1
  while (izquierda < derecha) {
    const medio = (izquierda + derecha) >> 1
    if (tiempo[medio] < t) izquierda = medio + 1
    else derecha = medio
  }
  return izquierda > 0 && Math.abs(tiempo[izquierda - 1] - t) <= Math.abs(tiempo[izquierda] - t) ? izquierda - 1 : izquierda
}

/**
 * Si la presión de la señal viene positiva al inspirar (formato viejo). El
 * equipo nuevo la manda negativa al inspirar, como el flujo. Se decide con
 * la misma sesión, así no depende de la versión del equipo:
 *   1. Con el signo de la presión en el momento de la PIM de cada ciclo
 *      (`momentosPim`, en segundos desde el inicio, como `tiempo`): gana la mayoría.
 *   2. Sin ciclos, comparándola con el flujo procesado (negativo al
 *      inspirar): si van al revés, la presión viene positiva al inspirar.
 *   3. Si no hay con qué decidir, se asume el formato nuevo.
 */
export function presionPositivaAlInspirar(
  tiempo: number[],
  presion: (number | null)[],
  momentosPim: number[],
  flujoProcesado: (number | null)[] | null,
): boolean {
  if (tiempo.length === 0) return false
  let positivas = 0
  let negativas = 0
  for (const t of momentosPim) {
    const valor = presion[masCercano(tiempo, t)]
    if (valor == null || valor === 0) continue
    if (valor > 0) positivas++
    else negativas++
  }
  if (positivas !== negativas) return positivas > negativas

  if (flujoProcesado) {
    let producto = 0
    for (let i = 0; i < presion.length; i++) {
      const p = presion[i]
      const q = flujoProcesado[i]
      if (p != null && q != null) producto += p * q
    }
    if (producto !== 0) return producto < 0
  }
  return false
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
 *
 * Las muestras de `forzar` (ej. las que tienen notas) quedan siempre.
 * `indices` dice de qué muestra de la señal original es cada punto.
 */
export function reducirSerie(
  x: number[],
  y: (number | null)[],
  maxPuntos = 1600,
  forzar: ReadonlySet<number> = new Set(),
): { x: number[]; y: (number | null)[]; indices: number[] } {
  const ventanas = Math.floor(maxPuntos / 2)
  if (x.length <= maxPuntos || ventanas < 1) return { x, y, indices: x.map((_, i) => i) }
  const tamano = x.length / ventanas
  const rx: number[] = []
  const ry: (number | null)[] = []
  const indices: number[] = []
  for (let v = 0; v < ventanas; v++) {
    const desde = Math.floor(v * tamano)
    const hasta = Math.min(Math.floor((v + 1) * tamano), x.length)
    let iMin = -1
    let iMax = -1
    let iHueco = -1
    const forzados: number[] = []
    for (let i = desde; i < hasta; i++) {
      if (forzar.has(i)) forzados.push(i)
      const valor = y[i]
      if (valor == null) {
        if (iHueco < 0) iHueco = i
        continue
      }
      if (iMin < 0 || valor < (y[iMin] as number)) iMin = i
      if (iMax < 0 || valor > (y[iMax] as number)) iMax = i
    }
    const elegidos = [...new Set([iMin, iMax, iHueco, ...forzados].filter((i) => i >= 0))].sort((a, b) => a - b)
    for (const i of elegidos) {
      if (rx.length === 0 || rx[rx.length - 1] !== x[i]) {
        rx.push(x[i])
        ry.push(y[i])
        indices.push(i)
      }
    }
  }
  return { x: rx, y: ry, indices }
}
