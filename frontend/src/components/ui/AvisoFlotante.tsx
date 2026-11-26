import { useEffect } from 'react'

export interface Aviso {
  tipo: 'ok' | 'error' | 'info'
  titulo: string
  detalle?: string
}

/** Cuánto queda a la vista un aviso de que salió bien (los de error quedan hasta cerrarlos). */
const DURACION_MS = 6000

/**
 * Aviso flotante abajo de la pantalla, donde está la persona después de
 * tocar "Guardar" (un mensaje arriba del formulario queda fuera de la vista).
 * Los de "ok" e "info" se van solos; los de error quedan hasta cerrarlos.
 */
export function AvisoFlotante({ aviso, onCerrar }: { aviso: Aviso | null; onCerrar: () => void }) {
  useEffect(() => {
    if (!aviso || aviso.tipo === 'error') return
    const t = window.setTimeout(onCerrar, DURACION_MS)
    return () => window.clearTimeout(t)
  }, [aviso, onCerrar])

  if (!aviso) return null
  return (
    <div className={`aviso-flotante ${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} aria-live="polite">
      <svg className="aviso-flotante-icono" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
        {aviso.tipo === 'ok' ? (
          <path d="M6 10.5l2.6 2.6L14.2 7.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M10 5.5v5.5M10 14.2v.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <div className="aviso-flotante-texto">
        <div className="aviso-flotante-titulo">{aviso.titulo}</div>
        {aviso.detalle && <div className="aviso-flotante-detalle">{aviso.detalle}</div>}
      </div>
      <button type="button" className="aviso-flotante-cerrar" onClick={onCerrar} aria-label="Cerrar aviso">
        ×
      </button>
    </div>
  )
}
