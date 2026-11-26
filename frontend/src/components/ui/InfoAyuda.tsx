import { useEffect, useId, useRef, useState } from 'react'

interface InfoAyudaProps {
  /** De qué es la ayuda (para el lector de pantalla): "Caída de la PIM". */
  sobre: string
  /** El texto que se muestra en el globito. */
  texto: string
}

/**
 * Un circulito rojo con una "i" al lado de una etiqueta: al pasar el mouse
 * (o al tocarlo, en el celular) muestra un globito que explica el dato.
 */
export function InfoAyuda({ sobre, texto }: InfoAyudaProps) {
  const [abierto, setAbierto] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)

  // Tocando afuera o con Esc se cierra (en el celular no hay "sacar el mouse").
  useEffect(() => {
    if (!abierto) return
    const alTocar = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', alTocar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('pointerdown', alTocar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  return (
    <span
      ref={ref}
      className="info-ayuda"
      onMouseEnter={() => setAbierto(true)}
      onMouseLeave={() => setAbierto(false)}
    >
      <button
        type="button"
        className="info-ayuda-boton"
        aria-label={`Qué es: ${sobre}`}
        aria-expanded={abierto}
        aria-describedby={abierto ? id : undefined}
        onClick={() => setAbierto(true)}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
      >
        i
      </button>
      {abierto && (
        <span role="tooltip" id={id} className="info-ayuda-globo">
          {texto}
        </span>
      )}
    </span>
  )
}
