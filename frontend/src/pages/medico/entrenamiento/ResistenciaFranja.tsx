import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EntrenamientoConFecha } from '../../../api/types'
import { isoArgentina } from '../../../data/mockData'

/**
 * Franja de la resistencia: cada tramo es un período en el que el paciente
 * entrenó con el mismo nivel (el `nivel_resistencia` que informa el equipo en
 * cada sesión), y abajo la lista de cambios. La usan la ficha del paciente y
 * el informe general en PDF.
 */

/** Más días que esto sin entrenar es una pausa en la franja. */
const DIAS_PAUSA = 8
const DIA_MS = 86_400_000
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Más claro = más abierta, más oscuro = más cerrada. */
const COLOR_NIVEL: Record<number, string> = { 1: '#a8e2ee', 2: '#7fd3e4', 3: '#2fb3cc', 4: '#0a7e96', 5: '#0c4f5e' }
const COLOR_PAUSA = '#eef3f4'

type Modo = 'automatico' | 'manual' | null

export interface TramoResistencia {
  tipo: 'nivel' | 'pausa'
  /** Días desde el 1/1/1970, con la fecha local del equipo. `hasta` no está incluido. */
  desde: number
  hasta: number
  nivel?: number
  modo?: Modo
  sesiones?: number
}

export interface CambioResistencia {
  dia: number
  /** null en el primer tramo ("Empezó en nivel N"). */
  nivelAnterior: number | null
  nivel: number
  modo: Modo
}

export interface FranjaDeResistencia {
  tramos: TramoResistencia[]
  /** Los cambios de nivel, el más reciente primero. */
  cambios: CambioResistencia[]
  desde: number
  hasta: number
}

/** "2026-11-17T18:30:00" (o "2026-11-17") → días desde el 1/1/1970. */
function diaDe(fecha: string): number {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(anio, mes - 1, dia) / DIA_MS)
}

/** Ej. "05 nov", como `formatearFecha` del resto de la ficha. */
export function fechaDeDia(dia: number): string {
  const d = new Date(dia * DIA_MS)
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MESES[d.getUTCMonth()]}`
}

export function textoCambio(c: CambioResistencia): string {
  if (c.nivelAnterior == null) return `Empezó en nivel ${c.nivel}`
  return `${c.nivel > c.nivelAnterior ? 'Subió' : 'Bajó'} de nivel ${c.nivelAnterior} a ${c.nivel}`
}

export function textoModo(modo: Modo): string {
  if (modo === 'manual') return 'manual'
  if (modo === 'automatico') return 'automático'
  return ''
}

/**
 * Arma los tramos a partir de las sesiones (en cualquier orden). Las que no
 * informan nivel no cuentan. Null si ninguna sesión informa el nivel.
 */
export function franjaDeResistencia(entrenamientos: EntrenamientoConFecha[], hoy = new Date()): FranjaDeResistencia | null {
  const sesiones = entrenamientos
    .filter((e) => e.nivel_resistencia != null)
    .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
    .map((e) => ({ dia: diaDe(e.fecha_hora), nivel: e.nivel_resistencia as number, modo: e.modo_resistencia }))
  if (sesiones.length === 0) return null

  const tramos: TramoResistencia[] = []
  sesiones.forEach((s, i) => {
    const anterior = sesiones[i - 1]
    const actual = tramos[tramos.length - 1]
    const hueco = anterior != null && s.dia - anterior.dia > DIAS_PAUSA
    if (hueco) {
      actual.hasta = anterior.dia + 1
      tramos.push({ tipo: 'pausa', desde: anterior.dia + 1, hasta: s.dia })
    }
    if (!actual || hueco || actual.nivel !== s.nivel) {
      if (actual && !hueco) actual.hasta = s.dia
      tramos.push({ tipo: 'nivel', desde: s.dia, hasta: s.dia + 1, nivel: s.nivel, modo: s.modo, sesiones: 1 })
    } else {
      actual.sesiones = (actual.sesiones ?? 0) + 1
    }
  })

  // El último nivel sigue hasta hoy, salvo que haga mucho que no entrena.
  const ultimo = sesiones[sesiones.length - 1].dia
  const diaHoy = Math.max(diaDe(isoArgentina(hoy)), ultimo)
  const final = tramos[tramos.length - 1]
  if (diaHoy - ultimo > DIAS_PAUSA) {
    final.hasta = ultimo + 1
    tramos.push({ tipo: 'pausa', desde: ultimo + 1, hasta: diaHoy + 1 })
  } else {
    final.hasta = diaHoy + 1
  }

  const niveles = tramos.filter((t) => t.tipo === 'nivel')
  const cambios: CambioResistencia[] = []
  niveles.forEach((t, k) => {
    const nivelAnterior = k === 0 ? null : (niveles[k - 1].nivel as number)
    // Volver de una pausa con el mismo nivel no es un cambio.
    if (nivelAnterior === t.nivel) return
    cambios.push({ dia: t.desde, nivelAnterior, nivel: t.nivel as number, modo: t.modo ?? null })
  })

  return { tramos, cambios: cambios.reverse(), desde: sesiones[0].dia, hasta: diaHoy + 1 }
}

interface FranjaResistenciaSvgProps extends FranjaDeResistencia {
  /** Ancho en px (el viewBox es del mismo tamaño, así el texto no se estira). */
  ancho: number
}

const ALTO_TRAMO = 52
const ALTO_SVG = 84

/** La franja sola, como SVG: es lo que se ve en la ficha y lo que va como imagen al PDF. */
export function FranjaResistenciaSvg({ tramos, desde, hasta, ancho }: FranjaResistenciaSvgProps) {
  const total = Math.max(hasta - desde, 1)
  const x = (dia: number) => ((dia - desde) / total) * ancho

  // Marcas abajo: el primer día, el 1 de cada mes (si no se pisa con otra) y "hoy".
  const marcas: { x: number; texto: string; ancla: 'start' | 'middle' | 'end' }[] = [
    { x: 1, texto: fechaDeDia(desde), ancla: 'start' },
  ]
  const finX = ancho - 1
  const primero = new Date(desde * DIA_MS)
  for (let m = 1; m < 120; m++) {
    const dia = Math.round(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + m, 1) / DIA_MS)
    if (dia >= hasta) break
    const xx = x(dia)
    if (xx - marcas[marcas.length - 1].x >= 56 && finX - xx >= 40) {
      marcas.push({ x: xx, texto: `1 ${MESES[new Date(dia * DIA_MS).getUTCMonth()]}`, ancla: 'middle' })
    }
  }
  marcas.push({ x: finX, texto: 'hoy', ancla: 'end' })

  return (
    <svg
      data-grafico=""
      width={ancho}
      height={ALTO_SVG}
      viewBox={`0 0 ${ancho} ${ALTO_SVG}`}
      role="img"
      aria-label="Franja con los períodos de cada nivel de resistencia"
    >
      {tramos.map((t, i) => {
        const x1 = x(t.desde) + 1
        const w = Math.max(x(t.hasta) - x(t.desde) - 2, 3)
        const centro = x1 + w / 2
        const periodo = `del ${fechaDeDia(t.desde)} al ${fechaDeDia(t.hasta - 1)}`

        if (t.tipo === 'pausa') {
          const texto = w >= 84 ? 'sin entrenar' : w >= 44 ? 'pausa' : ''
          return (
            <g key={i}>
              <title>{`Sin entrenar, ${periodo}`}</title>
              <rect x={x1} y={2} width={w} height={ALTO_TRAMO} rx={8} fill={COLOR_PAUSA} />
              {texto && (
                <text x={centro} y={32} fontSize="11" fill="#5C7C82" fontFamily="Nunito, sans-serif" textAnchor="middle">
                  {texto}
                </text>
              )}
            </g>
          )
        }

        const nivel = t.nivel as number
        const tinta = nivel <= 3 ? '#0C3A44' : '#FFFFFF'
        const sesiones = `${t.sesiones} ${t.sesiones === 1 ? 'sesión' : 'sesiones'}`
        const titulo = w >= 50 ? `Nivel ${nivel}` : w >= 16 ? String(nivel) : ''
        const conDetalle = w >= 80
        return (
          <g key={i}>
            <title>{`Nivel ${nivel} · ${sesiones} · ${periodo}`}</title>
            <rect x={x1} y={2} width={w} height={ALTO_TRAMO} rx={8} fill={COLOR_NIVEL[nivel] ?? COLOR_NIVEL[5]} />
            {titulo && (
              <text
                x={centro}
                y={conDetalle ? 25 : 32}
                fontSize="12"
                fontWeight="800"
                fill={tinta}
                fontFamily="Nunito, sans-serif"
                textAnchor="middle"
              >
                {titulo}
              </text>
            )}
            {conDetalle && (
              <text x={centro} y={41} fontSize="10.5" fill={tinta} fontFamily="Nunito, sans-serif" textAnchor="middle">
                {sesiones}
              </text>
            )}
          </g>
        )
      })}

      {marcas.map((m, i) => (
        <g key={i}>
          <line x1={m.x} y1={ALTO_TRAMO + 6} x2={m.x} y2={ALTO_TRAMO + 12} stroke="#B7CDD2" strokeWidth={1.5} />
          <text
            x={m.x}
            y={ALTO_TRAMO + 26}
            fontSize="10.5"
            fontWeight="700"
            fill="#5C7C82"
            fontFamily="Nunito, sans-serif"
            textAnchor={m.ancla}
          >
            {m.texto}
          </text>
        </g>
      ))}
    </svg>
  )
}

const CAMBIOS_VISIBLES = 5

/** El bloque de la ficha: título, franja (al ancho disponible) y la lista de cambios. */
export function ResistenciaFranja({ entrenamientos }: { entrenamientos: EntrenamientoConFecha[] }) {
  const franja = useMemo(() => franjaDeResistencia(entrenamientos), [entrenamientos])
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(640)
  const [verTodos, setVerTodos] = useState(false)
  const hayFranja = franja != null

  useLayoutEffect(() => {
    const el = contenedorRef.current
    if (!el) return
    const medir = () => setAncho(Math.max(240, Math.floor(el.clientWidth)))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [hayFranja])

  return (
    <section className="resistencia-franja" aria-labelledby="resistencia-franja-titulo">
      <h4 id="resistencia-franja-titulo" className="resistencia-franja-titulo">
        Resistencia en el tiempo
      </h4>
      {!franja ? (
        <p className="empty-state">Ninguna sesión informa el nivel de resistencia.</p>
      ) : (
        <>
          <p className="resistencia-franja-sub">
            Cada tramo es un período con el mismo nivel (1 = más abierta, 5 = más cerrada).
          </p>
          <div ref={contenedorRef}>
            <FranjaResistenciaSvg {...franja} ancho={ancho} />
          </div>

          <div className="resistencia-cambios-titulo">Cambios</div>
          <ul className="resistencia-cambios">
            {(verTodos ? franja.cambios : franja.cambios.slice(0, CAMBIOS_VISIBLES)).map((c, i) => (
              <li key={i} className="resistencia-cambio">
                <span className="resistencia-cambio-fecha">{fechaDeDia(c.dia)}</span>
                <IconoCambio cambio={c} />
                <span className="resistencia-cambio-texto">{textoCambio(c)}</span>
                {c.modo && <span className={`resistencia-modo resistencia-modo-${c.modo}`}>{textoModo(c.modo)}</span>}
              </li>
            ))}
          </ul>
          {franja.cambios.length > CAMBIOS_VISIBLES && (
            <button type="button" className="link resistencia-ver-todos" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? 'Ver menos' : `Ver los ${franja.cambios.length} cambios`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function IconoCambio({ cambio }: { cambio: CambioResistencia }) {
  if (cambio.nivelAnterior == null) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="3" fill="#5C7C82" />
      </svg>
    )
  }
  const sube = cambio.nivel > cambio.nivelAnterior
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={sube ? 'M7 11V3M3.5 6.5 7 3l3.5 3.5' : 'M7 3v8M3.5 7.5 7 11l3.5-3.5'}
        fill="none"
        stroke={sube ? '#0A7E96' : '#C22C78'}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
