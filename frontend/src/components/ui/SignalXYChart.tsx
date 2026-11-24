import { describirPuntoXY } from '../../anotaciones/notas'
import type { AnotacionesGrafico } from './ChartInteractivo'
import { ChartInteractivo } from './ChartInteractivo'

interface SignalXYChartProps {
  /** Valores del eje X, mismo orden y largo que `y`. */
  x: number[]
  /** Valores del eje Y. Un null es un hueco: la línea se corta ahí (no se toma como 0). */
  y: (number | null)[]
  etiquetaX: string
  etiquetaY: string
  caption?: string
  color?: string
  /** Si está, se pueden marcar muestras con notas (la clave de cada punto es su índice, o `clavesPuntos`). */
  anotaciones?: AnotacionesGrafico
  /**
   * Clave estable de cada punto, mismo orden y largo que `x`/`y`. Hace falta
   * si lo que se dibuja es un tramo o una versión reducida de la señal: así
   * una nota sigue en su muestra aunque cambie lo que se ve.
   */
  clavesPuntos?: string[]
  /** Franjas verticales sombreadas (ej. la inspiración y la espiración de cada ciclo), en unidades de X. */
  franjas?: FranjaXY[]
  /** Puntos destacados (ej. la PIM y la PEM de cada ciclo), en unidades de X e Y. */
  marcas?: MarcaXY[]
  /** Tiempo de cada punto, para compartir el cursor con los otros gráficos (ver cursorSincronizado.ts). */
  tiempos?: number[]
  /** Click en el gráfico: el índice del punto más cercano. */
  onClickPunto?: (indice: number) => void
  /** Tamaño del viewBox: más ancho que alto para gráficos apilados a lo ancho. */
  ancho?: number
  alto?: number
  /** Límites del eje X (por defecto, los de los datos). Sirve para acercarse a un tramo. */
  rangoX?: [number, number]
}

export interface FranjaXY {
  desde: number
  hasta: number
  color: string
}

export interface MarcaXY {
  x: number
  y: number
  color: string
  /** Texto al pasar el mouse. */
  titulo?: string
  /** Texto fijo al lado del punto (ej. el valor de la PIM). */
  etiqueta?: string
  /** Más grande y con borde: el punto del ciclo elegido. */
  destacada?: boolean
}

/** Gráfico XY genérico para una señal cruda (flujo/volumen/presión vs. tiempo, o flujo-volumen). */
export function SignalXYChart({
  x,
  y,
  etiquetaX,
  etiquetaY,
  caption,
  color = '#2FA7A0',
  anotaciones,
  clavesPuntos,
  franjas = [],
  marcas = [],
  tiempos,
  onClickPunto,
  ancho = 360,
  alto = 240,
  rangoX,
}: SignalXYChartProps) {
  const w = ancho
  const h = alto
  const padLeft = 50
  const padRight = 16
  const padTop = 18
  const padBottom = 34

  const plotW = w - padLeft - padRight
  const plotH = h - padTop - padBottom

  // Sólo las muestras con valor se dibujan y se pueden señalar; cada una
  // conserva su índice original (para las notas y el click).
  const validos: number[] = []
  y.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) validos.push(i)
  })
  const yValidos = validos.map((i) => y[i] as number)

  const xMin = rangoX ? rangoX[0] : Math.min(...x)
  const xMax = rangoX ? rangoX[1] : Math.max(...x)
  // El eje Y incluye las marcas visibles (ej. la PIM del JSON puede pasar apenas el pico de la señal).
  const yDeMarcas = marcas.filter((m) => m.x >= xMin && m.x <= xMax).map((m) => m.y)
  const yMin = Math.min(...yValidos, ...yDeMarcas)
  const yMax = Math.max(...yValidos, ...yDeMarcas)
  const xRango = xMax - xMin || 1
  const yRango = yMax - yMin || 1

  const puntos = validos.map((i) => ({
    x: padLeft + ((x[i] - xMin) / xRango) * plotW,
    y: padTop + plotH - (((y[i] as number) - yMin) / yRango) * plotH,
  }))
  // Un tramo de línea por cada racha de muestras seguidas con valor.
  const tramos: string[] = []
  let actual: string[] = []
  validos.forEach((original, k) => {
    if (k > 0 && original !== validos[k - 1] + 1 && actual.length > 0) {
      tramos.push(actual.join(' '))
      actual = []
    }
    actual.push(`${puntos[k].x.toFixed(1)},${puntos[k].y.toFixed(1)}`)
  })
  if (actual.length > 0) tramos.push(actual.join(' '))

  const marcasY = yMin === yMax ? [yMin] : [yMin, (yMin + yMax) / 2, yMax]
  const marcasX = xMin === xMax ? [xMin] : [xMin, (xMin + xMax) / 2, xMax]

  return (
    <ChartInteractivo
      ancho={w}
      alto={h}
      ariaLabel={caption ?? `${etiquetaY} vs ${etiquetaX}`}
      encabezado={
        caption && (
          <div className="signal-chart-title" style={{ color }}>
            {caption}
          </div>
        )
      }
      area={{ x: padLeft, y: padTop, ancho: plotW, alto: plotH }}
      posiciones={puntos}
      claves={validos.map((i) => clavesPuntos?.[i] ?? String(i))}
      describirPunto={(k) => describirPuntoXY(etiquetaX, etiquetaY, x[validos[k]], y[validos[k]] as number)}
      color={color}
      anotaciones={anotaciones}
      tiempos={tiempos ? validos.map((i) => tiempos[i]) : undefined}
      onClickPunto={onClickPunto ? (k) => onClickPunto(validos[k]) : undefined}
    >
      <text x={padLeft} y={12} fontSize="9.5" fill="#5C7C82" fontFamily="Nunito, sans-serif">
        {etiquetaY}
      </text>
      <text x={padLeft + plotW} y={h - 4} fontSize="9.5" fill="#5C7C82" fontFamily="Nunito, sans-serif" textAnchor="end">
        {etiquetaX}
      </text>

      {/* líneas de guía */}
      {marcasY.map((v) => {
        const yy = padTop + plotH - ((v - yMin) / yRango) * plotH
        return <line key={`gy-${v}`} x1={padLeft} y1={yy} x2={padLeft + plotW} y2={yy} stroke="#E7EDEF" strokeWidth={1} />
      })}
      {marcasX.map((v) => {
        const xx = padLeft + ((v - xMin) / xRango) * plotW
        return <line key={`gx-${v}`} x1={xx} y1={padTop} x2={xx} y2={padTop + plotH} stroke="#E7EDEF" strokeWidth={1} />
      })}

      {/* franjas sombreadas, recortadas al área del gráfico */}
      {franjas.map((f, i) => {
        const desde = Math.max(f.desde, xMin)
        const hasta = Math.min(f.hasta, xMax)
        if (!(hasta > desde)) return null
        const x1 = padLeft + ((desde - xMin) / xRango) * plotW
        const x2 = padLeft + ((hasta - xMin) / xRango) * plotW
        return <rect key={`f-${i}`} x={x1} y={padTop} width={x2 - x1} height={plotH} fill={f.color} />
      })}

      {/* eje Y */}
      <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="#B7CDD2" strokeWidth={1.5} />
      {/* eje X */}
      <line
        x1={padLeft}
        y1={padTop + plotH}
        x2={padLeft + plotW}
        y2={padTop + plotH}
        stroke="#B7CDD2"
        strokeWidth={1.5}
      />

      {marcasY.map((v) => {
        const yy = padTop + plotH - ((v - yMin) / yRango) * plotH
        return (
          <g key={`y-${v}`}>
            <line x1={padLeft - 4} y1={yy} x2={padLeft} y2={yy} stroke="#B7CDD2" strokeWidth={1.5} />
            <text x={padLeft - 8} y={yy + 3} fontSize="9" fill="#5C7C82" fontFamily="Nunito, sans-serif" textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        )
      })}

      {marcasX.map((v) => {
        const xx = padLeft + ((v - xMin) / xRango) * plotW
        return (
          <g key={`x-${v}`}>
            <line x1={xx} y1={padTop + plotH} x2={xx} y2={padTop + plotH + 4} stroke="#B7CDD2" strokeWidth={1.5} />
            <text x={xx} y={padTop + plotH + 16} fontSize="9" fill="#5C7C82" fontFamily="Nunito, sans-serif" textAnchor="middle">
              {v.toFixed(1)}
            </text>
          </g>
        )
      })}

      {tramos.map((tramo, i) => (
        <polyline key={i} points={tramo} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {marcas.map((m, i) => {
        if (m.x < xMin || m.x > xMax || m.y < yMin || m.y > yMax) return null
        const cx = padLeft + ((m.x - xMin) / xRango) * plotW
        const cy = padTop + plotH - ((m.y - yMin) / yRango) * plotH
        return (
          <g key={`m-${i}`} pointerEvents="none">
            <circle
              cx={cx}
              cy={cy}
              r={m.destacada ? 5 : 3.2}
              fill={m.color}
              stroke={m.destacada ? '#0C3A44' : '#fff'}
              strokeWidth={m.destacada ? 1.5 : 1}
            >
              {m.titulo && <title>{m.titulo}</title>}
            </circle>
            {m.etiqueta && (
              <text
                x={cx + 6}
                y={cy < padTop + 12 ? cy + 12 : cy - 6}
                fontSize="9"
                fontWeight="800"
                fill={m.color}
                fontFamily="Nunito, sans-serif"
              >
                {m.etiqueta}
              </text>
            )}
          </g>
        )
      })}
    </ChartInteractivo>
  )
}
