import { createContext, useCallback, useMemo, useState } from 'react'

/**
 * Cursor compartido entre los gráficos de un mismo visor: al pasar el mouse
 * por uno, todos muestran la línea punteada en el mismo instante. Se
 * sincroniza por TIEMPO (no por índice), así sirve aunque cada gráfico tenga
 * otra cantidad de puntos (ej. señales reducidas) o no sea una serie de
 * tiempo (la curva flujo-volumen marca el punto de ese instante).
 *
 * Uso: `const cursor = useCursorNuevo()` en el visor, envolver los gráficos
 * en `<CursorContext.Provider value={cursor}>` y pasarle a cada gráfico el
 * tiempo de cada punto (`tiempos`). Sin Provider, cada gráfico anda solo.
 */
export interface CursorSincronizado {
  /** Tiempo (en las unidades de `tiempos`) bajo el mouse, o null. */
  t: number | null
  /** Qué gráfico lo movió: ese muestra el tooltip, los demás sólo la línea. */
  origen: string | null
  mover: (t: number | null, origen: string) => void
}

export const CursorContext = createContext<CursorSincronizado | null>(null)

export function useCursorNuevo(): CursorSincronizado {
  const [estado, setEstado] = useState<{ t: number | null; origen: string | null }>({ t: null, origen: null })
  const mover = useCallback((t: number | null, origen: string) => {
    setEstado((actual) => {
      // Sólo quien lo movió puede soltarlo (al salir de un gráfico no se borra
      // el cursor que ya puso otro).
      if (t == null && actual.origen !== origen) return actual
      if (actual.t === t && actual.origen === origen) return actual
      return { t, origen: t == null ? null : origen }
    })
  }, [])
  return useMemo(() => ({ ...estado, mover }), [estado, mover])
}

/** Índice del valor de `ordenados` (crecientes) más cercano a `t`. */
export function indiceMasCercano(ordenados: number[], t: number): number | null {
  if (ordenados.length === 0) return null
  let izquierda = 0
  let derecha = ordenados.length - 1
  while (izquierda < derecha) {
    const medio = (izquierda + derecha) >> 1
    if (ordenados[medio] < t) izquierda = medio + 1
    else derecha = medio
  }
  const anterior = izquierda - 1
  if (anterior >= 0 && Math.abs(ordenados[anterior] - t) <= Math.abs(ordenados[izquierda] - t)) return anterior
  return izquierda
}
