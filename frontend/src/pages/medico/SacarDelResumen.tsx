import { EyeIcon } from '../../components/ui/EyeIcon'

/**
 * Lo mismo que el ojito de las tablas de la ficha, pero desde el visor de la
 * señal: si al mirarla se ve algo raro, se la marca como fallida ahí mismo y
 * deja de aparecer en los gráficos de evolución, el CSV y el informe.
 */
export interface EstadoOculta {
  oculta: boolean
  guardando: boolean
  error: string | null
  cambiar: () => void
}

interface BotonSacarDelResumenProps {
  estado: EstadoOculta
  /** "esta sesión", "este entrenamiento"… para el texto de ayuda. */
  que: string
}

export function BotonSacarDelResumen({ estado, que }: BotonSacarDelResumenProps) {
  const { oculta, guardando, cambiar } = estado
  return (
    <button
      type="button"
      className={`btn btn-sm ${oculta ? 'btn-teal' : 'btn-outline'}`}
      onClick={cambiar}
      disabled={guardando}
      aria-pressed={oculta}
      title={
        oculta
          ? `Fuera del resumen: ${que} no aparece en los gráficos de evolución, el CSV ni el informe. Tocá para volver a incluir.`
          : `Sacar ${que} del resumen (por ejemplo, si falló): deja de aparecer en los gráficos de evolución, el CSV y el informe`
      }
    >
      <EyeIcon tachado={oculta} className="icon-16" />
      {oculta ? 'Volver a incluir' : 'Sacar del resumen'}
    </button>
  )
}

/** Aviso arriba de la señal mientras está oculta (y el error si no se pudo guardar). */
export function AvisoOculta({ estado, que }: BotonSacarDelResumenProps) {
  return (
    <>
      {estado.error && <div className="auth-alert error">{estado.error}</div>}
      {estado.oculta && (
        <div className="auth-alert info">
          Fuera del resumen: {que} no aparece en los gráficos de evolución, el CSV ni el informe. La señal se sigue
          pudiendo ver acá.
        </div>
      )}
    </>
  )
}
