import { DuckLogo } from '../ui/DuckLogo'
import { WaveBottom } from '../ui/WaveBottom'
import { useSession } from '../../auth/session'
import { Link, useNavigate } from 'react-router-dom'

function iniciales(nombre: string, apellido: string, fallback: string): string {
  const a = nombre.trim()[0] ?? ''
  const b = apellido.trim()[0] ?? ''
  const ini = (a + b) || fallback.replace(/[^a-zA-Z]/g, '').slice(0, 2)
  return (ini || '??').toUpperCase()
}

export function Header() {
  const { perfil, cerrarSesion } = useSession()
  const navigate = useNavigate()

  let nombreMostrado = ''
  let etiquetaRol = ''
  let ini = '??'
  if (perfil?.rol === 'medico') {
    const { nombre, apellido, usuario } = perfil.datos
    nombreMostrado = `${nombre} ${apellido}`.trim() || usuario
    etiquetaRol = 'Médico/a'
    ini = iniciales(nombre, apellido, usuario)
  } else if (perfil?.rol === 'paciente') {
    const { nombre, apellido, email, nombre_usuario } = perfil.datos
    const nombreCompleto = `${nombre ?? ''} ${apellido ?? ''}`.trim()
    nombreMostrado = nombreCompleto || email || nombre_usuario
    etiquetaRol = 'Paciente'
    ini = iniciales(nombre ?? '', apellido ?? '', email ?? nombre_usuario)
  }

  return (
    <header className="topwave">
      <a href="#contenido-principal" className="skip-link">
        Saltar al contenido principal
      </a>
      <div className="topbar">
        {/* El patito lleva al inicio, como el logo de cualquier página. El `state`
            avisa que se tocó (ver PatientDashboard), así vuelve al resumen
            aunque ya se esté en "/". */}
        <Link
          to="/"
          state={{ inicio: Date.now() }}
          className="brand"
          aria-label="Bronquito: ir al inicio"
          title="Ir al inicio"
          onClick={() => window.scrollTo({ top: 0 })}
        >
          <DuckLogo className="brand-duck" />
          <div>
            <div className="brand-name">Bronquito</div>
            <div className="brand-tag">La vía para respirar mejor</div>
          </div>
        </Link>

        <div className="who">
          <button
            className="who-profile"
            type="button"
            onClick={() => navigate('/configuracion')}
            aria-label="Abrir configuración de perfil"
          >
            <div className="avatar" aria-hidden="true">
              {ini}
            </div>
            <div>
              <div className="who-name">{nombreMostrado}</div>
              <div className="who-role">{etiquetaRol}</div>
            </div>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={cerrarSesion}>
            Salir
          </button>
        </div>
      </div>
      <WaveBottom />
    </header>
  )
}
