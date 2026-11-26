import { useEffect, useMemo, useState } from 'react'
import type { CicloEntrenamiento, EntrenamientoDetalle, SenalEntrenamiento } from '../../../api/types'
import { ApiError, api } from '../../../api/client'
import { useSession } from '../../../auth/session'
import type { FranjaXY, MarcaXY } from '../../../components/ui/SignalXYChart'
import { SignalXYChart } from '../../../components/ui/SignalXYChart'
import { InfoAyuda } from '../../../components/ui/InfoAyuda'
import { CursorContext, indiceMasCercano, useCursorNuevo } from '../../../components/ui/cursorSincronizado'
import { describirPuntoXY, marcadoresDe } from '../../../anotaciones/notas'
import {
  claveComentariosEntrenamiento,
  claveGraficoEntrenamiento,
  comentariosDeEntrenamiento,
  useAnotaciones,
} from '../../../anotaciones/useAnotaciones'
import { NotasSesionPanel } from '../NotasSesionPanel'
import type { PuntoAnotado } from '../NotasSesionPanel'
import * as f from './formato'
import type { EstadoOculta } from '../SacarDelResumen'
import { AvisoOculta, BotonSacarDelResumen } from '../SacarDelResumen'

interface TrainingViewerProps {
  idPaciente: number
  idEntrenamiento: number
  onVolver: () => void
  /** Marcar la sesión como fallida (fuera de los gráficos de evolución, el CSV y el informe). */
  sacarDelResumen?: EstadoOculta
  onAnterior?: () => void
  onSiguiente?: () => void
  onUltima?: () => void
}

const COLOR_PRESION = '#E0A030'
const COLOR_FLUJO = '#2FA7A0'
const FRANJA_INSP = 'rgba(18, 168, 196, 0.12)'
const FRANJA_ESP = 'rgba(240, 69, 154, 0.10)'
// El ciclo elegido, más marcado.
const FRANJA_INSP_ELEGIDO = 'rgba(18, 168, 196, 0.32)'
const FRANJA_ESP_ELEGIDO = 'rgba(240, 69, 154, 0.28)'
const MARCA_PIM = '#D1234F'
const MARCA_PEM = '#7C5CF0'
const MARCA_PIF = '#0A7E96'
const MARCA_PEF = '#C22C78'
/** Segundos que se muestran antes y después del ciclo al acercarse. */
const MARGEN_CICLO_S = 0.4
/** Tamaño (viewBox) de cada gráfico apilado: ancho y bajo. */
const ANCHO_GRAFICO = 900
const ALTO_GRAFICO = 230

/** Inspiración: de t_inicio a t_inicio + ti. Espiración: te segundos hasta t_fin. */
function franjasDe(ciclos: CicloEntrenamiento[], elegido: number | null): FranjaXY[] {
  return ciclos.flatMap((c, i) => {
    const marcado = i === elegido
    const franjas: FranjaXY[] = []
    if (c.t_inicio_s != null && c.ti_s != null) {
      franjas.push({ desde: c.t_inicio_s, hasta: c.t_inicio_s + c.ti_s, color: marcado ? FRANJA_INSP_ELEGIDO : FRANJA_INSP })
    }
    if (c.t_fin_s != null && c.te_s != null) {
      franjas.push({ desde: c.t_fin_s - c.te_s, hasta: c.t_fin_s, color: marcado ? FRANJA_ESP_ELEGIDO : FRANJA_ESP })
    }
    return franjas
  })
}

/**
 * Dónde va el punto de un pico: el valor del JSON (sin su signo) con el signo
 * que tiene la señal en ese instante. Así queda sobre el pico venga el JSON
 * con el signo que venga; si la señal no tiene valor ahí, `signoPorDefecto`.
 */
function enElPico(
  valor: number, t: number, tiempo: number[], senal: (number | null)[], signoPorDefecto: 1 | -1,
): number {
  const i = indiceMasCercano(tiempo, t)
  const enSenal = i == null ? null : senal[i]
  const signo = enSenal != null && enSenal !== 0 ? Math.sign(enSenal) : signoPorDefecto
  return signo * Math.abs(valor)
}

/**
 * PIM y PEM de cada ciclo sobre la presión (ya con la inspiración en
 * negativo). El ciclo elegido lleva el valor escrito, con la convención clínica.
 */
function marcasPresion(
  ciclos: CicloEntrenamiento[], elegido: number | null, tiempo: number[], presion: (number | null)[],
): MarcaXY[] {
  return ciclos.flatMap((c, i) => {
    const destacada = i === elegido
    const marcas: MarcaXY[] = []
    const pim = f.pimClinica(c.pim_cmH2O)
    const pem = f.pemClinica(c.pem_cmH2O)
    if (c.t_pim_s != null && pim != null) {
      marcas.push({
        x: c.t_pim_s, y: enElPico(pim, c.t_pim_s, tiempo, presion, -1), color: MARCA_PIM, destacada,
        titulo: `Ciclo ${c.numero ?? '?'} · PIM ${f.num(pim, 1, 'cmH₂O')}`,
        etiqueta: destacada ? `PIM ${f.num(pim, 1)}` : undefined,
      })
    }
    if (c.t_pem_s != null && pem != null) {
      marcas.push({
        x: c.t_pem_s, y: enElPico(pem, c.t_pem_s, tiempo, presion, 1), color: MARCA_PEM, destacada,
        titulo: `Ciclo ${c.numero ?? '?'} · PEM ${f.num(pem, 1, 'cmH₂O')}`,
        etiqueta: destacada ? `PEM ${f.num(pem, 1)}` : undefined,
      })
    }
    return marcas
  })
}

/**
 * PIF y PEF de cada ciclo sobre el flujo, en t_pif / t_pef.
 * - Con el flujo procesado, el punto va en el PIF / PEF del JSON, del lado
 *   del pico de esa misma señal (inspiración en negativo).
 * - Con el flujo crudo, va sobre la señal en ese instante (el crudo no
 *   coincide con el JSON); el valor escrito es siempre el del JSON.
 */
function marcasFlujo(
  ciclos: CicloEntrenamiento[], elegido: number | null, tiempo: number[], flujo: (number | null)[], procesado: boolean,
): MarcaXY[] {
  const enSenal = (t: number) => {
    const i = indiceMasCercano(tiempo, t)
    return i == null ? null : flujo[i]
  }
  return ciclos.flatMap((c, i) => {
    const destacada = i === elegido
    const marcas: MarcaXY[] = []
    const yPif =
      c.t_pif_s == null
        ? null
        : procesado && c.pif_Lmin != null
          ? enElPico(c.pif_Lmin, c.t_pif_s, tiempo, flujo, -1)
          : enSenal(c.t_pif_s)
    const yPef =
      c.t_pef_s == null
        ? null
        : procesado && c.pef_Lmin != null
          ? enElPico(c.pef_Lmin, c.t_pef_s, tiempo, flujo, 1)
          : enSenal(c.t_pef_s)
    if (c.t_pif_s != null && yPif != null) {
      marcas.push({
        x: c.t_pif_s, y: yPif, color: MARCA_PIF, destacada,
        titulo: `Ciclo ${c.numero ?? '?'} · PIF ${f.num(f.picoFlujo(c.pif_Lmin), 1, 'L/min')}`,
        etiqueta: destacada ? `PIF ${f.num(f.picoFlujo(c.pif_Lmin), 1)}` : undefined,
      })
    }
    if (c.t_pef_s != null && yPef != null) {
      marcas.push({
        x: c.t_pef_s, y: yPef, color: MARCA_PEF, destacada,
        titulo: `Ciclo ${c.numero ?? '?'} · PEF ${f.num(f.picoFlujo(c.pef_Lmin), 1, 'L/min')}`,
        etiqueta: destacada ? `PEF ${f.num(f.picoFlujo(c.pef_Lmin), 1)}` : undefined,
      })
    }
    return marcas
  })
}

/** El tramo [desde, hasta] de una señal, con todos sus puntos (para acercarse a un ciclo). */
function tramo(
  tiempo: number[], valores: (number | null)[], desde: number, hasta: number,
): { x: number[]; y: (number | null)[]; indices: number[] } {
  const x: number[] = []
  const y: (number | null)[] = []
  const indices: number[] = []
  for (let i = 0; i < tiempo.length; i++) {
    if (tiempo[i] >= desde && tiempo[i] <= hasta) {
      x.push(tiempo[i])
      y.push(valores[i])
      indices.push(i)
    }
  }
  return { x, y, indices }
}

/** Las muestras (índice en la señal) que tienen alguna nota. */
function muestrasConNotas(notas: { punto: string | null }[]): Set<number> {
  return new Set(notas.flatMap((a) => (a.punto != null && /^\d+$/.test(a.punto) ? [Number(a.punto)] : [])))
}

/** Los dos gráficos de la señal: su id (parte de la clave de las notas: no cambiarlo) y cómo se ven. */
const GRAFICO_PRESION = { id: 'presion-tiempo', titulo: 'Presión en función del tiempo', color: COLOR_PRESION }
const GRAFICO_FLUJO = { id: 'flujo-tiempo', titulo: 'Flujo en función del tiempo', color: COLOR_FLUJO }
const ETIQUETA_TIEMPO = 'Tiempo (s)'
const ETIQUETA_PRESION = 'Presión (cmH₂O)'

interface Metrica {
  etiqueta: string
  valor: string
  detalle?: string
  /** Si está, al lado de la etiqueta va una "i" roja que lo explica. */
  ayuda?: string
}

const AYUDA_CAIDA_PIM =
  'Compara la fuerza de la PIM del último tercio de los ciclos con la del primer tercio: ' +
  '(primeros − últimos) / primeros × 100. Positiva = la PIM cayó (fatiga); negativa = subió. ' +
  'Solo mira el principio y el final de la sesión.'
const AYUDA_PENDIENTE_PIM =
  'Cuánto cambia la fuerza de la PIM por ciclo, según una recta ajustada a todos los ciclos. ' +
  'Negativa = perdió fuerza a lo largo de la sesión (fatiga); positiva = ganó. ' +
  'Como usa todos los ciclos, un ciclo raro al principio o al final pesa menos que en la caída.'

function GrupoMetricas({ titulo, metricas, className = '' }: { titulo: string; metricas: Metrica[]; className?: string }) {
  return (
    <section className={`card ent-grupo ${className}`}>
      <h4>{titulo}</h4>
      <dl className="ent-metricas">
        {metricas.map((m) => (
          <div key={m.etiqueta} className="ent-metrica">
            <dt>
              {m.etiqueta}
              {m.ayuda && <InfoAyuda sobre={m.etiqueta} texto={m.ayuda} />}
            </dt>
            <dd>
              {m.valor}
              {m.detalle && <span className="ent-metrica-detalle">{m.detalle}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Visor de una sesión de entrenamiento: datos de la sesión, métricas, señales por ciclo y tabla. */
export function TrainingViewer({
  idPaciente,
  idEntrenamiento,
  onVolver,
  sacarDelResumen,
  onAnterior,
  onSiguiente,
  onUltima,
}: TrainingViewerProps) {
  const { token } = useSession()
  const [sesion, setSesion] = useState<EntrenamientoDetalle | null>(null)
  const [senal, setSenal] = useState<SenalEntrenamiento | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Índice (en `ciclos`) del ciclo elegido, o null = toda la sesión. */
  const [elegido, setElegido] = useState<number | null>(null)
  /** Con un ciclo elegido: acercar los gráficos a ese ciclo. */
  const [acercar, setAcercar] = useState(true)
  const cursor = useCursorNuevo()
  const notasPaciente = useAnotaciones(idPaciente)
  /** El punto al que se fue desde el panel de notas (abre su burbuja). */
  const [enfoque, setEnfoque] = useState<{ grafico: string; punto: string } | null>(null)
  const clavePresion = claveGraficoEntrenamiento(idEntrenamiento, GRAFICO_PRESION.id)
  const claveFlujo = claveGraficoEntrenamiento(idEntrenamiento, GRAFICO_FLUJO.id)

  useEffect(() => {
    if (!token) return
    let cancelado = false
    setCargando(true)
    setError(null)
    setSenal(null)
    setElegido(null)
    setEnfoque(null)
    api.medico
      .entrenamientoDe(token, idPaciente, idEntrenamiento)
      .then(async (detalle) => {
        if (cancelado) return
        setSesion(detalle)
        if (detalle.tiene_senal) {
          const datos = await api.medico.senalDeEntrenamiento(token, idPaciente, idEntrenamiento).catch(() => null)
          if (!cancelado) setSenal(datos)
        }
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : 'No pudimos cargar esta sesión.')
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [token, idPaciente, idEntrenamiento])

  const ciclos = useMemo(() => sesion?.ciclos ?? [], [sesion])

  // Con las flechas del teclado se pasa de un ciclo al otro.
  useEffect(() => {
    if (ciclos.length === 0) return
    function alTeclear(e: KeyboardEvent) {
      const objetivo = e.target as HTMLElement | null
      if (objetivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return
      if (e.key === 'ArrowRight') setElegido((i) => (i == null ? 0 : Math.min(i + 1, ciclos.length - 1)))
      else if (e.key === 'ArrowLeft') setElegido((i) => (i == null ? ciclos.length - 1 : Math.max(i - 1, 0)))
      else if (e.key === 'Escape') setElegido(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [ciclos.length])

  // La señal completa: el tiempo tal cual viene del CSV (tiempo_ms / 1000).
  // No se le resta la primera muestra: el equipo calcula los t_*_s del JSON
  // con ese mismo tiempo, y si se restara (la primera muestra es 0,01 s) cada
  // punto de PIM/PEM/PIF/PEF quedaría 10 ms corrido de su pico. La presión va
  // con la inspiración en negativo (como la manda el equipo; las sesiones
  // viejas la traían al revés y se dan vuelta) y el flujo procesado (el de
  // las métricas); si el CSV no lo trae, el crudo.
  const completa = useMemo(() => {
    if (!senal || senal.tiempo_s.length === 0) return null
    const tiempo = senal.tiempo_s
    const procesado = senal.flujo_proc_lmin != null
    const momentosPim = ciclos.flatMap((c) => (c.t_pim_s != null ? [c.t_pim_s] : []))
    const darVuelta = f.presionPositivaAlInspirar(tiempo, senal.presion_cmh2o, momentosPim, senal.flujo_proc_lmin)
    return {
      tiempo,
      presion: darVuelta ? senal.presion_cmh2o.map((p) => 0 - p) : senal.presion_cmh2o,
      flujo: senal.flujo_proc_lmin ?? senal.flujo_lmin,
      procesado,
    }
  }, [senal, ciclos])

  const cicloElegido = elegido != null ? ciclos[elegido] ?? null : null
  const ventana: [number, number] | null =
    acercar && cicloElegido?.t_inicio_s != null && cicloElegido.t_fin_s != null
      ? [cicloElegido.t_inicio_s - MARGEN_CICLO_S, cicloElegido.t_fin_s + MARGEN_CICLO_S]
      : null

  // Las notas de cada gráfico, y qué muestras tienen alguna (así no se
  // pierden al reducir la señal para dibujar la sesión entera).
  const notasPresion = useMemo(
    () => notasPaciente.anotaciones.filter((a) => a.grafico === clavePresion),
    [notasPaciente.anotaciones, clavePresion],
  )
  const notasFlujo = useMemo(
    () => notasPaciente.anotaciones.filter((a) => a.grafico === claveFlujo),
    [notasPaciente.anotaciones, claveFlujo],
  )
  const forzarPresion = useMemo(() => muestrasConNotas(notasPresion), [notasPresion])
  const forzarFlujo = useMemo(() => muestrasConNotas(notasFlujo), [notasFlujo])

  // Lo que se grafica: el tramo del ciclo con todos sus puntos, o la sesión
  // entera reducida (mínimo y máximo por ventana, sin perder los picos ni las
  // muestras con notas). `indices` es la muestra de la señal de cada punto.
  const graficos = useMemo(() => {
    if (!completa) return null
    if (ventana) {
      return {
        presion: tramo(completa.tiempo, completa.presion, ventana[0], ventana[1]),
        flujo: tramo(completa.tiempo, completa.flujo, ventana[0], ventana[1]),
      }
    }
    return {
      presion: f.reducirSerie(completa.tiempo, completa.presion, undefined, forzarPresion),
      flujo: f.reducirSerie(completa.tiempo, completa.flujo, undefined, forzarFlujo),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completa, ventana?.[0], ventana?.[1], forzarPresion, forzarFlujo])

  // Los puntos con notas de los dos gráficos, para listarlos en el panel.
  const puntosAnotados: PuntoAnotado[] = completa
    ? [
        { def: GRAFICO_PRESION, clave: clavePresion, notas: notasPresion, y: completa.presion, etiquetaY: ETIQUETA_PRESION },
        {
          def: GRAFICO_FLUJO,
          clave: claveFlujo,
          notas: notasFlujo,
          y: completa.flujo,
          etiquetaY: completa.procesado ? 'Flujo procesado (L/min)' : 'Flujo crudo (L/min)',
        },
      ].flatMap((g) =>
        marcadoresDe(
          completa.tiempo.map((_, i) => String(i)),
          g.notas,
        ).map((m) => {
          const valor = g.y[m.indice]
          const { principal, secundario } = describirPuntoXY(ETIQUETA_TIEMPO, g.etiquetaY, completa.tiempo[m.indice], valor ?? 0)
          return {
            grafico: g.clave,
            punto: m.punto,
            numero: m.numero,
            tituloGrafico: g.def.titulo,
            color: g.def.color,
            descripcion: `${principal} · ${secundario}`,
            notas: m.notas,
          }
        }),
      )
    : []

  /**
   * Desde el panel: abre la burbuja de ese punto. Si está fuera del ciclo que
   * se está mirando de cerca, pasa al ciclo de ese momento (o a toda la sesión).
   */
  function irAPunto(grafico: string, punto: string) {
    const t = completa?.tiempo[Number(punto)]
    if (t != null && acercar && elegido != null) {
      const actual = ciclos[elegido]
      const adentro = actual?.t_inicio_s != null && actual.t_fin_s != null && t >= actual.t_inicio_s - MARGEN_CICLO_S && t <= actual.t_fin_s + MARGEN_CICLO_S
      if (!adentro) {
        const i = ciclos.findIndex((c) => c.t_inicio_s != null && c.t_fin_s != null && t >= c.t_inicio_s && t <= c.t_fin_s)
        setElegido(i >= 0 ? i : null)
      }
    }
    setEnfoque({ grafico, punto })
  }

  const franjas = useMemo(() => franjasDe(ciclos, elegido), [ciclos, elegido])
  const marcasP = useMemo(
    () => (completa ? marcasPresion(ciclos, elegido, completa.tiempo, completa.presion) : []),
    [ciclos, elegido, completa],
  )
  const marcasF = useMemo(
    () => (completa ? marcasFlujo(ciclos, elegido, completa.tiempo, completa.flujo, completa.procesado) : []),
    [ciclos, elegido, completa],
  )

  /** Click en un gráfico: elige el ciclo de ese instante. */
  function elegirEnTiempo(t: number) {
    const i = ciclos.findIndex((c) => c.t_inicio_s != null && c.t_fin_s != null && t >= c.t_inicio_s && t <= c.t_fin_s)
    if (i >= 0) setElegido(i)
  }

  if (cargando) return <p className="empty-state">Cargando sesión…</p>
  if (error || !sesion) return <p className="empty-state">{error ?? 'No encontramos esa sesión.'}</p>

  const p = sesion.promedios
  const m = sesion.multiciclo

  const pendientePim = f.pendienteFuerzaPim(m?.pendiente_pim_por_ciclo, p?.pim_cmH2O ?? m?.pim_max_cmH2O)
  const grupos: { titulo: string; metricas: Metrica[] }[] = [
    {
      titulo: 'Sesión',
      metricas: [
        { etiqueta: 'Ciclos completos', valor: f.ciclosHechos(sesion) },
        { etiqueta: 'Duración', valor: f.duracion(sesion.duracion_s) },
        { etiqueta: 'Frecuencia', valor: f.num(m?.frecuencia_rpm, 1, 'rpm') },
        { etiqueta: 'Período medio', valor: f.num(m?.periodo_medio_s, 2, 's') },
        { etiqueta: 'Ventilación minuto', valor: f.num(m?.ventilacion_minuto_Lmin, 1, 'L/min') },
        { etiqueta: 'Fases sueltas', valor: f.num(m?.n_fases_sueltas, 0) },
      ],
    },
    {
      titulo: 'Presiones',
      metricas: [
        { etiqueta: 'PIM promedio', valor: f.num(f.pimClinica(p?.pim_cmH2O), 1, 'cmH₂O') },
        { etiqueta: 'PIM máxima', valor: f.num(f.pimClinica(m?.pim_max_cmH2O), 1, 'cmH₂O'), detalle: f.enCiclo(m?.pim_max_ciclo) },
        { etiqueta: 'PEM promedio', valor: f.num(f.pemClinica(p?.pem_cmH2O), 1, 'cmH₂O') },
        { etiqueta: 'PEM máxima', valor: f.num(f.pemClinica(m?.pem_max_cmH2O), 1, 'cmH₂O'), detalle: f.enCiclo(m?.pem_max_ciclo) },
        {
          etiqueta: 'Caída de la PIM',
          valor: f.num(m?.caida_pim_pct, 1, '%'),
          detalle: m?.caida_pim_pct != null ? (m.caida_pim_pct > 0 ? ' cayó' : ' no cayó') : undefined,
          ayuda: AYUDA_CAIDA_PIM,
        },
        {
          etiqueta: 'Pendiente de la PIM',
          valor: f.num(pendientePim, 2, 'cmH₂O/ciclo'),
          detalle: pendientePim != null && pendientePim !== 0 ? (pendientePim < 0 ? ' perdió fuerza' : ' ganó fuerza') : undefined,
          ayuda: AYUDA_PENDIENTE_PIM,
        },
      ],
    },
    {
      titulo: 'Flujo y volumen',
      metricas: [
        { etiqueta: 'PIF promedio', valor: f.num(f.picoFlujo(p?.pif_Lmin), 1, 'L/min') },
        { etiqueta: 'PIF máximo', valor: f.num(f.picoFlujo(m?.pif_max_Lmin), 1, 'L/min'), detalle: f.enCiclo(m?.pif_max_ciclo) },
        { etiqueta: 'PEF promedio', valor: f.num(f.picoFlujo(p?.pef_Lmin), 1, 'L/min') },
        { etiqueta: 'PEF máximo', valor: f.num(f.picoFlujo(m?.pef_max_Lmin), 1, 'L/min'), detalle: f.enCiclo(m?.pef_max_ciclo) },
        { etiqueta: 'Volumen inspirado prom.', valor: f.num(p?.vol_insp_L, 2, 'L') },
        { etiqueta: 'Volumen espirado prom.', valor: f.num(p?.vol_esp_L, 2, 'L') },
      ],
    },
    {
      titulo: 'Tiempo y trabajo',
      metricas: [
        { etiqueta: 'Ti', valor: f.num(p?.ti_s, 2, 's') },
        { etiqueta: 'Te', valor: f.num(p?.te_s, 2, 's') },
        { etiqueta: 'Pausa', valor: f.num(p?.pausa_s, 2, 's') },
        { etiqueta: 'Ti/Ttot', valor: f.num(p?.ti_ttot, 2) },
        { etiqueta: 'Trabajo insp. promedio', valor: f.num(p?.trabajo_insp_J, 2, 'J') },
        { etiqueta: 'Trabajo insp. total', valor: f.num(m?.trabajo_total_insp_J, 1, 'J') },
        { etiqueta: 'Potencia insp. promedio', valor: f.num(p?.potencia_insp_W, 2, 'W') },
      ],
    },
  ]

  // Las variables del ciclo elegido, con el promedio de la sesión al lado.
  const c = cicloElegido
  const prom = (valor: string) => ` prom. ${valor}`
  const metricasCiclo: Metrica[] = c
    ? [
        { etiqueta: 'Tramo', valor: `${f.num(c.t_inicio_s, 2)} – ${f.num(c.t_fin_s, 2)} s` },
        { etiqueta: 'PIM', valor: f.num(f.pimClinica(c.pim_cmH2O), 1, 'cmH₂O'), detalle: prom(f.num(f.pimClinica(p?.pim_cmH2O), 1)) },
        { etiqueta: 'PEM', valor: f.num(f.pemClinica(c.pem_cmH2O), 1, 'cmH₂O'), detalle: prom(f.num(f.pemClinica(p?.pem_cmH2O), 1)) },
        { etiqueta: 'PIF', valor: f.num(f.picoFlujo(c.pif_Lmin), 1, 'L/min'), detalle: prom(f.num(f.picoFlujo(p?.pif_Lmin), 1)) },
        { etiqueta: 'PEF', valor: f.num(f.picoFlujo(c.pef_Lmin), 1, 'L/min'), detalle: prom(f.num(f.picoFlujo(p?.pef_Lmin), 1)) },
        { etiqueta: 'Volumen inspirado', valor: f.num(c.vol_insp_L, 2, 'L'), detalle: prom(f.num(p?.vol_insp_L, 2)) },
        { etiqueta: 'Volumen espirado', valor: f.num(c.vol_esp_L, 2, 'L'), detalle: prom(f.num(p?.vol_esp_L, 2)) },
        { etiqueta: 'Ti', valor: f.num(c.ti_s, 2, 's'), detalle: prom(f.num(p?.ti_s, 2)) },
        { etiqueta: 'Te', valor: f.num(c.te_s, 2, 's'), detalle: prom(f.num(p?.te_s, 2)) },
        { etiqueta: 'Pausa', valor: f.num(c.pausa_s, 2, 's'), detalle: prom(f.num(p?.pausa_s, 2)) },
        { etiqueta: 'Ti/Ttot', valor: f.num(c.ti_ttot, 2), detalle: prom(f.num(p?.ti_ttot, 2)) },
        { etiqueta: 'Trabajo inspiratorio', valor: f.num(c.trabajo_insp_J, 2, 'J'), detalle: prom(f.num(p?.trabajo_insp_J, 2)) },
        { etiqueta: 'Potencia inspiratoria', valor: f.num(c.potencia_insp_W, 2, 'W'), detalle: prom(f.num(p?.potencia_insp_W, 2)) },
        { etiqueta: 'Momento de la PIM / PEM', valor: `${f.num(c.t_pim_s, 2)} / ${f.num(c.t_pem_s, 2)} s` },
        { etiqueta: 'Momento del PIF / PEF', valor: `${f.num(c.t_pif_s, 2)} / ${f.num(c.t_pef_s, 2)} s` },
      ]
    : []

  return (
    <div>
      <div className="signal-viewer-header">
        <button className="btn btn-red btn-sm" onClick={onVolver}>
          ← Volver
        </button>
        <button className="btn btn-outline btn-sm" onClick={onAnterior} disabled={!onAnterior} title="Sesión anterior">
          ◀ Anterior
        </button>
        <button className="btn btn-outline btn-sm" onClick={onSiguiente} disabled={!onSiguiente} title="Sesión siguiente">
          Siguiente ▶
        </button>
        <button className="btn btn-outline btn-sm" onClick={onUltima} disabled={!onUltima} title="Ir a la última sesión">
          Ir a última sesión
        </button>
        <h3>Entrenamiento · {f.fecha(sesion)}</h3>

        {sacarDelResumen && (
          <div className="signal-header-acciones">
            <BotonSacarDelResumen estado={sacarDelResumen} que="este entrenamiento" />
          </div>
        )}
      </div>

      {sacarDelResumen && <AvisoOculta estado={sacarDelResumen} que="este entrenamiento" />}

      <div className="card ent-encabezado">
        <div>
          <span className="ent-etiqueta">Duración</span>
          <strong>{f.duracion(sesion.duracion_s)}</strong>
        </div>
        <div>
          <span className="ent-etiqueta">Estado</span>
          <strong>
            <span className={`entrenamiento-estado estado-${sesion.estado ?? 'desconocido'}`}>{f.estado(sesion)}</span>
          </strong>
        </div>
        <div>
          <span className="ent-etiqueta">Cómo terminó</span>
          <strong>{f.finTexto(sesion)}</strong>
        </div>
        <div>
          <span className="ent-etiqueta">Resistencia</span>
          <strong>{f.resistencia(sesion)}</strong>
        </div>
        <div>
          <span className="ent-etiqueta">Ambiente</span>
          <strong>
            {f.num(sesion.temperatura_c, 1, '°C')} · {f.num(sesion.humedad_rel_pct, 0, '% HR')} · BTPS{' '}
            {f.num(sesion.factor_btps, 4)}
          </strong>
        </div>
      </div>

      {sesion.formato_anterior && (
        <div className="auth-alert info">
          Sesión de una versión anterior del equipo: pueden faltar datos. La caída de la PIM ya está corregida al
          criterio nuevo (positiva = cayó).
        </div>
      )}

      {!sesion.analizada ? (
        <div className="auth-alert info">Sin análisis: el equipo no pudo analizar esta sesión.</div>
      ) : (
        <div className="ent-grupos">
          {grupos.map((g) => (
            <GrupoMetricas
              key={g.titulo}
              titulo={g.titulo}
              metricas={g.metricas}
              className={g.titulo === 'Presiones' ? 'ent-grupo-ancho' : ''}
            />
          ))}
        </div>
      )}

      {ciclos.length > 0 && (
        <div className="card ent-selector">
          <div className="ent-selector-fila">
            <strong>Ciclos</strong>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setElegido((i) => (i == null ? ciclos.length - 1 : Math.max(i - 1, 0)))}
              disabled={elegido === 0}
              title="Ciclo anterior (←)"
            >
              ◀
            </button>
            <div className="ent-chips" role="listbox" aria-label="Elegir un ciclo">
              <button
                role="option"
                aria-selected={elegido == null}
                className={`ent-chip ${elegido == null ? 'activo' : ''}`}
                onClick={() => setElegido(null)}
              >
                Todos
              </button>
              {ciclos.map((ciclo, i) => (
                <button
                  key={ciclo.numero ?? `i-${i}`}
                  role="option"
                  aria-selected={elegido === i}
                  className={`ent-chip ${elegido === i ? 'activo' : ''}`}
                  onClick={() => setElegido(i)}
                >
                  {ciclo.numero ?? i + 1}
                </button>
              ))}
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setElegido((i) => (i == null ? 0 : Math.min(i + 1, ciclos.length - 1)))}
              disabled={elegido === ciclos.length - 1}
              title="Ciclo siguiente (→)"
            >
              ▶
            </button>
            {completa && (
              <label className="ent-acercar">
                <input type="checkbox" checked={acercar} onChange={(e) => setAcercar(e.target.checked)} />
                Acercar al ciclo
              </label>
            )}
          </div>
          <p className="ent-ayuda">
            Tocá un ciclo en los gráficos o en la tabla para ver sus valores; tocando un punto también le podés dejar
            una nota. Con ← y → pasás de ciclo; Esc vuelve a toda la sesión.
          </p>
        </div>
      )}

      <div className="ent-senales">
        <div className="ent-graficos-apilados">
          {!graficos ? (
            <div className="auth-alert info">Señal no disponible: el equipo no mandó la señal de esta sesión.</div>
          ) : (
            <CursorContext.Provider value={cursor}>
              <SignalXYChart
                x={graficos.presion.x}
                y={graficos.presion.y}
                tiempos={graficos.presion.x}
                etiquetaX={ETIQUETA_TIEMPO}
                etiquetaY={ETIQUETA_PRESION}
                caption={GRAFICO_PRESION.titulo}
                color={GRAFICO_PRESION.color}
                franjas={franjas}
                marcas={marcasP}
                ancho={ANCHO_GRAFICO}
                alto={ALTO_GRAFICO}
                onClickPunto={(i) => elegirEnTiempo(graficos.presion.x[i])}
                clavesPuntos={graficos.presion.indices.map(String)}
                anotaciones={notasPaciente.paraGrafico(clavePresion, {
                  enfocar: enfoque?.grafico === clavePresion ? enfoque : null,
                })}
              />
              <SignalXYChart
                x={graficos.flujo.x}
                y={graficos.flujo.y}
                tiempos={graficos.flujo.x}
                etiquetaX="Tiempo (s)"
                etiquetaY={completa?.procesado ? 'Flujo procesado (L/min)' : 'Flujo crudo (L/min) · señal cruda, solo ilustrativa'}
                caption={completa?.procesado ? 'Flujo en función del tiempo' : 'Flujo en función del tiempo (señal cruda, solo ilustrativa)'}
                color={COLOR_FLUJO}
                franjas={franjas}
                marcas={marcasF}
                ancho={ANCHO_GRAFICO}
                alto={ALTO_GRAFICO}
                onClickPunto={(i) => elegirEnTiempo(graficos.flujo.x[i])}
                clavesPuntos={graficos.flujo.indices.map(String)}
                anotaciones={notasPaciente.paraGrafico(claveFlujo, {
                  enfocar: enfoque?.grafico === claveFlujo ? enfoque : null,
                })}
              />
              {ciclos.length > 0 && (
                <p className="ent-leyenda">
                  <span className="ent-muestra" style={{ background: FRANJA_INSP_ELEGIDO }} /> Inspiración
                  <span className="ent-muestra" style={{ background: FRANJA_ESP_ELEGIDO }} /> Espiración
                  <span className="ent-punto" style={{ background: MARCA_PIM }} /> PIM
                  <span className="ent-punto" style={{ background: MARCA_PEM }} /> PEM
                  <span className="ent-punto" style={{ background: MARCA_PIF }} /> PIF
                  <span className="ent-punto" style={{ background: MARCA_PEF }} /> PEF
                </p>
              )}
            </CursorContext.Provider>
          )}
        </div>

        {/* A la derecha: el ciclo elegido (si hay) y las notas de la sesión. */}
        <div className="ent-columna-derecha">
          {c && (
            <GrupoMetricas
              className="ent-ciclo-elegido"
              titulo={`Ciclo ${c.numero ?? (elegido ?? 0) + 1} de ${ciclos.length}`}
              metricas={metricasCiclo}
            />
          )}
          <NotasSesionPanel
            comentarios={comentariosDeEntrenamiento(notasPaciente.anotaciones, idEntrenamiento)}
            puntosAnotados={puntosAnotados}
            idMedicoActual={notasPaciente.idMedicoActual}
            error={notasPaciente.error}
            ayudaComentarios="Valen para toda la sesión de entrenamiento, no para un punto en particular."
            onComentar={(texto) => notasPaciente.crear({ texto, grafico: claveComentariosEntrenamiento(idEntrenamiento) })}
            onEditar={notasPaciente.editar}
            onBorrar={notasPaciente.borrar}
            onIrAPunto={irAPunto}
          />
        </div>
      </div>

      {ciclos.length > 0 && (
        <div className="table-wrap mt-16">
          <table className="ent-tabla-ciclos">
            <thead>
              <tr>
                <th>Ciclo</th>
                <th>Inicio (s)</th>
                <th>Fin (s)</th>
                <th>Ti (s)</th>
                <th>Te (s)</th>
                <th>Pausa (s)</th>
                <th>Ti/Ttot</th>
                <th>PIF (L/min)</th>
                <th>PEF (L/min)</th>
                <th>Vol. insp. (L)</th>
                <th>Vol. esp. (L)</th>
                <th>PIM (cmH₂O)</th>
                <th>PEM (cmH₂O)</th>
                <th>Trabajo insp. (J)</th>
                <th>Potencia insp. (W)</th>
              </tr>
            </thead>
            <tbody>
              {ciclos.map((ciclo, i) => (
                <tr
                  key={ciclo.numero ?? `i-${i}`}
                  className={`ent-fila-ciclo ${elegido === i ? 'elegida' : ''}`}
                  onClick={() => setElegido((actual) => (actual === i ? null : i))}
                  title="Ver este ciclo en los gráficos"
                >
                  <td>{ciclo.numero ?? f.SIN_DATO}</td>
                  <td>{f.num(ciclo.t_inicio_s, 2)}</td>
                  <td>{f.num(ciclo.t_fin_s, 2)}</td>
                  <td>{f.num(ciclo.ti_s, 2)}</td>
                  <td>{f.num(ciclo.te_s, 2)}</td>
                  <td>{f.num(ciclo.pausa_s, 2)}</td>
                  <td>{f.num(ciclo.ti_ttot, 2)}</td>
                  <td>{f.num(f.picoFlujo(ciclo.pif_Lmin), 1)}</td>
                  <td>{f.num(f.picoFlujo(ciclo.pef_Lmin), 1)}</td>
                  <td>{f.num(ciclo.vol_insp_L, 2)}</td>
                  <td>{f.num(ciclo.vol_esp_L, 2)}</td>
                  <td>{f.num(f.pimClinica(ciclo.pim_cmH2O), 1)}</td>
                  <td>{f.num(f.pemClinica(ciclo.pem_cmH2O), 1)}</td>
                  <td>{f.num(ciclo.trabajo_insp_J, 2)}</td>
                  <td>{f.num(ciclo.potencia_insp_W, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
