import type { Anotacion, Entrenamiento, EntrenamientoConFecha, Evaluacion } from '../../api/types'
import type { SerieTendencia } from '../../components/ui/TrendChartCarousel'
import { notaParaCsv } from '../../anotaciones/notas'
import { claveGraficoEvolucion } from '../../anotaciones/useAnotaciones'
import { formatearFecha } from '../../data/mockData'
import { aCsv } from '../../exportar/archivos'
import { pimClinica } from './entrenamiento/formato'

/**
 * Qué se grafica en la evolución del paciente, en un solo lugar: lo usan la
 * ficha del paciente, su CSV y el informe general en PDF.
 */

/** Una sesión de consultorio: la espirometría y el PIM que se tomaron juntos. */
export interface SesionEvaluacion {
  fecha_hora: string
  espirometria?: Evaluacion
  pim?: Evaluacion
}

/**
 * Dos evaluaciones son la misma sesión de consultorio si comparten el
 * `fecha_hora` exacto (se captura una sola vez al arrancar la sesión).
 * Mantiene el orden de entrada.
 */
export function agruparEnSesiones(evaluaciones: Evaluacion[]): SesionEvaluacion[] {
  const porFecha = new Map<string, SesionEvaluacion>()
  for (const e of evaluaciones) {
    const sesion = porFecha.get(e.fecha_hora) ?? { fecha_hora: e.fecha_hora }
    if (e.tipo === 'ESPIROMETRIA') sesion.espirometria = e
    else sesion.pim = e
    porFecha.set(e.fecha_hora, sesion)
  }
  return [...porFecha.values()]
}

export interface VariableEvolucion<T> {
  /** Identificador estable (parte de la clave de las notas: no cambiarlo). */
  id: string
  nombreCorto: string
  /** Para el título: "Evolución de <etiqueta>". */
  etiqueta: string
  etiquetaEje: string
  unidad: string
  valor: (item: T) => number | null | undefined
}

export const VARIABLES_EVALUACION: VariableEvolucion<Evaluacion>[] = [
  { id: 'pim', nombreCorto: 'PIM', etiqueta: 'PIM', etiquetaEje: 'PIM (cmH₂O)', unidad: 'cmH₂O', valor: (e) => e.pim },
  { id: 'fvc', nombreCorto: 'FVC', etiqueta: 'FVC', etiquetaEje: 'FVC (L)', unidad: 'L', valor: (e) => e.fvc },
  { id: 'fev1', nombreCorto: 'FEV1', etiqueta: 'FEV1', etiquetaEje: 'FEV1 (L)', unidad: 'L', valor: (e) => e.fev1 },
  { id: 'pef', nombreCorto: 'PEF', etiqueta: 'PEF', etiquetaEje: 'PEF (L/min)', unidad: 'L/min', valor: (e) => e.pef },
  { id: 'fivc', nombreCorto: 'FIVC', etiqueta: 'FIVC', etiquetaEje: 'FIVC (L)', unidad: 'L', valor: (e) => e.fivc },
  { id: 'fiv1', nombreCorto: 'FIV1', etiqueta: 'FIV1', etiquetaEje: 'FIV1 (L)', unidad: 'L', valor: (e) => e.fiv1 },
]

/**
 * Evolución entre sesiones de entrenamiento. PIM con la convención clínica
 * (negativa); caída de la PIM > 0 = cayó. Las sesiones sin análisis no
 * aportan puntos (sus valores son null).
 */
export const VARIABLES_ENTRENAMIENTO: VariableEvolucion<Entrenamiento>[] = [
  { id: 'pim-promedio', nombreCorto: 'PIM prom.', etiqueta: 'PIM promedio', etiquetaEje: 'PIM promedio (cmH₂O)', unidad: 'cmH₂O', valor: (e) => pimClinica(e.promedios?.pim_cmH2O) },
  { id: 'vol-insp-promedio', nombreCorto: 'Vol. insp. prom.', etiqueta: 'volumen inspirado promedio', etiquetaEje: 'Vol. inspirado prom. (L)', unidad: 'L', valor: (e) => e.promedios?.vol_insp_L },
  { id: 'trabajo-total', nombreCorto: 'Trabajo total', etiqueta: 'trabajo inspiratorio total', etiquetaEje: 'Trabajo total (J)', unidad: 'J', valor: (e) => e.multiciclo?.trabajo_total_insp_J },
  { id: 'ciclos-completos', nombreCorto: 'Ciclos', etiqueta: 'ciclos completos', etiquetaEje: 'Ciclos completos', unidad: '', valor: (e) => e.n_ciclos_completos },
  { id: 'caida-pim', nombreCorto: 'Caída PIM', etiqueta: 'caída de la PIM', etiquetaEje: 'Caída de la PIM (%)', unidad: '%', valor: (e) => e.multiciclo?.caida_pim_pct },
  { id: 'potencia-promedio', nombreCorto: 'Potencia', etiqueta: 'potencia inspiratoria promedio', etiquetaEje: 'Potencia insp. prom. (W)', unidad: 'W', valor: (e) => e.promedios?.potencia_insp_W },
  { id: 'nivel-resistencia', nombreCorto: 'Resistencia', etiqueta: 'nivel de resistencia', etiquetaEje: 'Nivel de resistencia', unidad: '', valor: (e) => e.nivel_resistencia },
]

/**
 * Las que se grafican como línea. La resistencia no: va en su propia franja
 * (entrenamiento/ResistenciaFranja.tsx), pero sigue en el CSV y en la tabla del PDF.
 */
const VARIABLES_ENTRENAMIENTO_GRAFICOS = VARIABLES_ENTRENAMIENTO.filter((v) => v.id !== 'nivel-resistencia')

/** Fecha y hora para el CSV y el detalle de un punto, ej. "2026-10-11 10:15". */
function fechaHoraCompleta(fechaHora: string): string {
  return fechaHora.replace('T', ' ').slice(0, 16)
}

const PALETA_SERIES = ['#F0459A', '#2FA7A0', '#7C5CF0', '#E0A030', '#3B82F6', '#D1234F', '#1F9D64', '#B9820C']

/** Arma una serie por variable, salteando los valores vacíos. `datos` en orden cronológico. */
function construirSeries<T extends { fecha_hora: string }>(
  grupo: 'evaluaciones' | 'entrenamientos',
  datos: T[],
  idDe: (item: T) => number,
  variables: VariableEvolucion<T>[],
): SerieTendencia[] {
  return variables.map((variable, i) => {
    const puntos = datos
      .map((item) => ({ item, valor: variable.valor(item) }))
      .filter((p): p is { item: T; valor: number } => p.valor != null)
    return {
      nombreCorto: variable.nombreCorto,
      titulo: `Evolución de ${variable.etiqueta}`,
      etiquetaEje: variable.etiquetaEje,
      unidad: variable.unidad,
      color: PALETA_SERIES[i % PALETA_SERIES.length],
      valores: puntos.map((p) => p.valor),
      fechas: puntos.map((p) => formatearFecha(p.item.fecha_hora)),
      clave: claveGraficoEvolucion(grupo, variable.id),
      clavesPuntos: puntos.map((p) => String(idDe(p.item))),
      fechasCompletas: puntos.map((p) => fechaHoraCompleta(p.item.fecha_hora)),
    }
  })
}

export function seriesDeEvaluaciones(evaluacionesCronologicas: Evaluacion[]): SerieTendencia[] {
  return construirSeries('evaluaciones', evaluacionesCronologicas, (e) => e.id_evaluacion, VARIABLES_EVALUACION)
}

export function seriesDeEntrenamientos(entrenamientosCronologicos: EntrenamientoConFecha[]): SerieTendencia[] {
  return construirSeries('entrenamientos', entrenamientosCronologicos, (e) => e.id_entrenamiento, VARIABLES_ENTRENAMIENTO_GRAFICOS)
}

/**
 * CSV con todos los puntos de los gráficos de evolución de una pestaña: una
 * fila por fecha, una columna por variable y, en "Notas", las notas de esos
 * puntos aclarando de qué variable es cada una. Cada fila puede juntar
 * varios registros de la misma fecha (la espirometría y el PIM de una sesión).
 */
function csvDeEvolucion<T extends { fecha_hora: string }>(
  grupo: 'evaluaciones' | 'entrenamientos',
  filas: T[][],
  variables: VariableEvolucion<T>[],
  idDe: (item: T) => number,
  anotaciones: Anotacion[],
): string {
  const cuerpo = filas.map((items) => {
    const ids = new Set(items.map((item) => String(idDe(item))))
    const notas = variables.flatMap((variable) => {
      const grafico = claveGraficoEvolucion(grupo, variable.id)
      return anotaciones
        .filter((a) => a.grafico === grafico && a.punto != null && ids.has(a.punto))
        .map((a) => notaParaCsv(a, variable.nombreCorto))
    })
    return [
      fechaHoraCompleta(items[0].fecha_hora),
      ...variables.map((variable) => items.map(variable.valor).find((v) => v != null) ?? null),
      notas.join(' | '),
    ]
  })
  return aCsv([['Fecha', ...variables.map((v) => v.etiquetaEje), 'Notas'], ...cuerpo])
}

/** En el CSV, las columnas van en el mismo orden que la tabla de la ficha (PIM al final). */
const VARIABLES_EVALUACION_CSV = ['fvc', 'fev1', 'pef', 'fivc', 'fiv1', 'pim'].map(
  (id) => VARIABLES_EVALUACION.find((v) => v.id === id)!,
)

export function csvDeEvaluaciones(evaluacionesCronologicas: Evaluacion[], anotaciones: Anotacion[]): string {
  const sesiones = agruparEnSesiones(evaluacionesCronologicas).map((s) =>
    [s.espirometria, s.pim].filter((e): e is Evaluacion => e != null),
  )
  return csvDeEvolucion('evaluaciones', sesiones, VARIABLES_EVALUACION_CSV, (e) => e.id_evaluacion, anotaciones)
}

export function csvDeEntrenamientos(entrenamientosCronologicos: EntrenamientoConFecha[], anotaciones: Anotacion[]): string {
  return csvDeEvolucion(
    'entrenamientos',
    entrenamientosCronologicos.map((e) => [e]),
    VARIABLES_ENTRENAMIENTO,
    (e) => e.id_entrenamiento,
    anotaciones,
  )
}
