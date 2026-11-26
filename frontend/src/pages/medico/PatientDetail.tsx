import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Paciente } from '../../types'
import type { Entrenamiento, Evaluacion, Frecuencia, Rutina } from '../../api/types'
import { ApiError, api } from '../../api/client'
import { useSession } from '../../auth/session'
import { useAnotaciones } from '../../anotaciones/useAnotaciones'
import { TrendChartCarousel } from '../../components/ui/TrendChartCarousel'
import { MonthCalendar } from '../../components/ui/MonthCalendar'
import { Modal } from '../../components/ui/Modal'
import { TrashIcon } from '../../components/ui/TrashIcon'
import { EyeIcon } from '../../components/ui/EyeIcon'
import { FrequencyModal } from './FrequencyModal'
import { ResistenciaTag } from './ResistenciaEquipo'
import * as fmtEntrenamiento from './entrenamiento/formato'
import { ResistenciaFranja } from './entrenamiento/ResistenciaFranja'
import { formatearFecha, formatearHora, isoArgentina } from '../../data/mockData'
import { TIPO_CSV, TIPO_PDF, elegirDestino } from '../../exportar/archivos'
import {
  agruparEnSesiones,
  csvDeEntrenamientos,
  csvDeEvaluaciones,
  seriesDeEntrenamientos,
  seriesDeEvaluaciones,
} from './evolucion'

type Tab = 'evaluaciones' | 'entrenamiento' | 'calendario'

interface PatientDetailProps {
  paciente: Paciente
  onDesvincular: () => Promise<void>
}

export function PatientDetail({ paciente, onDesvincular }: PatientDetailProps) {
  const { token, perfil } = useSession()
  const navigate = useNavigate()
  // La pestaña vive también en la URL (?pestana=entrenamiento), para volver a
  // la misma después de inspeccionar una señal.
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTabEstado] = useState<Tab>(() => {
    const pestana = searchParams.get('pestana')
    return pestana === 'entrenamiento' || pestana === 'calendario' ? pestana : 'evaluaciones'
  })
  function setTab(nueva: Tab) {
    setTabEstado(nueva)
    setSearchParams(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales)
        nuevos.set('pestana', nueva)
        return nuevos
      },
      { replace: true },
    )
  }
  const [historialFrecuencia, setHistorialFrecuencia] = useState<Frecuencia[]>([])
  const [modalFrecuencia, setModalFrecuencia] = useState(false)
  const [confirmarDesvinculo, setConfirmarDesvinculo] = useState(false)
  const [desvinculando, setDesvinculando] = useState(false)
  const [errorDesvinculo, setErrorDesvinculo] = useState<string | null>(null)

  async function confirmarYDesvincular() {
    setDesvinculando(true)
    setErrorDesvinculo(null)
    try {
      await onDesvincular()
    } catch (err) {
      setErrorDesvinculo(err instanceof Error ? err.message : 'No se pudo desvincular al paciente.')
      setDesvinculando(false)
    }
  }

  const [evaluaciones, setEvaluaciones] = useState<Evaluacion[]>([])
  const [cargandoEvaluaciones, setCargandoEvaluaciones] = useState(true)
  const [errorEvaluaciones, setErrorEvaluaciones] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelado = false
    setCargandoEvaluaciones(true)
    setErrorEvaluaciones(null)
    api.medico
      .evaluacionesDe(token, Number(paciente.id))
      .then((datos) => {
        if (!cancelado) setEvaluaciones(datos)
      })
      .catch((err) => {
        if (cancelado) return
        setErrorEvaluaciones(err instanceof ApiError ? err.message : 'No pudimos cargar las evaluaciones.')
      })
      .finally(() => {
        if (!cancelado) setCargandoEvaluaciones(false)
      })
    return () => {
      cancelado = true
    }
  }, [token, paciente.id])

  const [entrenamientos, setEntrenamientos] = useState<Entrenamiento[]>([])
  const [cargandoEntrenamientos, setCargandoEntrenamientos] = useState(true)
  const [errorEntrenamientos, setErrorEntrenamientos] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelado = false
    setCargandoEntrenamientos(true)
    setErrorEntrenamientos(null)
    api.medico
      .entrenamientosDe(token, Number(paciente.id))
      .then((datos) => {
        if (!cancelado) setEntrenamientos(datos)
      })
      .catch((err) => {
        if (cancelado) return
        setErrorEntrenamientos(err instanceof ApiError ? err.message : 'No pudimos cargar los entrenamientos.')
      })
      .finally(() => {
        if (!cancelado) setCargandoEntrenamientos(false)
      })
    return () => {
      cancelado = true
    }
  }, [token, paciente.id])

  const [rutina, setRutina] = useState<Rutina | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelado = false
    api.medico
      .rutinaDe(token, Number(paciente.id))
      .then((datos) => {
        if (!cancelado) setRutina(datos)
      })
      .catch(() => {
        // Si falla, el tag de resistencia queda como "sin definir".
      })
    return () => {
      cancelado = true
    }
  }, [token, paciente.id])

  useEffect(() => {
    if (!token) return
    let cancelado = false
    api.medico
      .historialFrecuencia(token, Number(paciente.id))
      .then((datos) => {
        if (!cancelado) setHistorialFrecuencia(datos)
      })
      .catch(() => {
        // Si falla, el calendario simplemente no muestra días recomendados.
      })
    return () => {
      cancelado = true
    }
  }, [token, paciente.id])

  // La espirometría y el PIM de una misma sesión de consultorio van en una sola fila de la tabla.
  const sesiones = useMemo(() => agruparEnSesiones(evaluaciones), [evaluaciones])

  const hoy = new Date()
  const hoyIso = isoArgentina(hoy)

  // La API ya devuelve el historial más reciente primero; para desempatar
  // cambios del mismo día lo invertimos (más viejo primero, ver MonthCalendar).
  const historialParaCalendario = useMemo(
    () =>
      [...historialFrecuencia].reverse().map((f) => ({ vigenteDesde: f.vigente_desde, dias: f.dias_semana })),
    [historialFrecuencia],
  )

  // La entrada vigente hoy es siempre la primera del historial (la API lo
  // ordena por vigente_desde/creado_en descendente, y el servidor siempre
  // marca vigente_desde = hoy al crear una nueva).
  const frecuenciaVigente = historialFrecuencia[0]

  const diasConEntrenamiento = useMemo(
    () => new Set(entrenamientos.flatMap((e) => (e.fecha_hora ? [e.fecha_hora.slice(0, 10)] : []))),
    [entrenamientos],
  )

  // Una evaluación por día (si hay espirometría y PIM del mismo día, se prioriza
  // la espirometría) — para saber a qué evaluación llevar al clickear el banderín.
  const evaluacionPorFecha = useMemo(() => {
    const mapa = new Map<string, Evaluacion>()
    for (const e of evaluaciones) {
      const iso = e.fecha_hora.slice(0, 10)
      const actual = mapa.get(iso)
      if (!actual || (actual.tipo !== 'ESPIROMETRIA' && e.tipo === 'ESPIROMETRIA')) {
        mapa.set(iso, e)
      }
    }
    return mapa
  }, [evaluaciones])

  // Las mediciones marcadas como fallidas (el ojito) siguen en las tablas, en
  // gris, pero no entran en los gráficos, en el PIM inicial/actual ni en el CSV.
  const evaluacionesCronologicas = evaluaciones.filter((e) => !e.oculta).reverse()
  // Las sesiones sin fecha no se pueden ubicar en la evolución (sí aparecen en la tabla).
  const entrenamientosCronologicos = entrenamientos
    .filter((e) => !e.oculta)
    .filter(fmtEntrenamiento.conFecha)
    .reverse()
  const hayEvaluacionesOcultas = evaluaciones.some((e) => e.oculta)
  const hayEntrenamientosOcultos = entrenamientos.some((e) => e.oculta)
  const seriesEvaluaciones = seriesDeEvaluaciones(evaluacionesCronologicas)
  const seriesEntrenamiento = seriesDeEntrenamientos(entrenamientosCronologicos)

  const notasPaciente = useAnotaciones(Number(paciente.id))
  const [generandoInforme, setGenerandoInforme] = useState(false)
  const [errorExportacion, setErrorExportacion] = useState<string | null>(null)
  const [errorOcultar, setErrorOcultar] = useState<string | null>(null)

  // Cambiar de pestaña o de paciente descarta el error de la exportación anterior.
  useEffect(() => {
    setErrorExportacion(null)
    setErrorOcultar(null)
  }, [tab, paciente.id])

  /** Lo que se está por borrar: abre el modal de confirmación. */
  const [aBorrar, setABorrar] = useState<MedicionABorrar | null>(null)

  /**
   * Borra esas mediciones de a una (si falla a mitad, lo que ya se borró
   * desaparece de la tabla igual). El servidor recuerda el archivo de cada
   * una, así no vuelve a aparecer si el dispositivo la manda de nuevo.
   */
  async function borrarMediciones(tipo: 'evaluacion' | 'entrenamiento', ids: number[]) {
    for (const id of ids) {
      if (tipo === 'evaluacion') {
        await api.medico.borrarEvaluacion(token!, Number(paciente.id), id)
        setEvaluaciones((actuales) => actuales.filter((e) => e.id_evaluacion !== id))
      } else {
        await api.medico.borrarEntrenamiento(token!, Number(paciente.id), id)
        setEntrenamientos((actuales) => actuales.filter((e) => e.id_entrenamiento !== id))
      }
    }
  }

  /**
   * El ojito de cada fila: marca (o desmarca) esas mediciones como fallidas.
   * Se ve al toque y, si el servidor no lo guarda, vuelve como estaba.
   */
  async function cambiarOculta(tipo: 'evaluacion' | 'entrenamiento', ids: number[], oculta: boolean) {
    if (!token || ids.length === 0) return
    setErrorOcultar(null)
    const cuales = new Set(ids)
    const aplicar = (valor: boolean) => {
      if (tipo === 'evaluacion') {
        setEvaluaciones((actuales) => actuales.map((e) => (cuales.has(e.id_evaluacion) ? { ...e, oculta: valor } : e)))
      } else {
        setEntrenamientos((actuales) => actuales.map((e) => (cuales.has(e.id_entrenamiento) ? { ...e, oculta: valor } : e)))
      }
    }
    aplicar(oculta)
    try {
      await api.medico.ocultarMediciones(token, Number(paciente.id), tipo, ids, oculta)
    } catch (err) {
      aplicar(!oculta)
      setErrorOcultar(err instanceof ApiError ? err.message : 'No se pudo guardar el cambio. Probá de nuevo.')
    }
  }

  /** Un solo CSV con los puntos de todos los gráficos de evolución de la pestaña abierta. */
  async function descargarCsv() {
    setErrorExportacion(null)
    const grupo = tab === 'evaluaciones' ? 'Evaluaciones' : 'Entrenamientos'
    const destino = await elegirDestino(`${grupo} ${paciente.nombre} ${hoyIso}.csv`, TIPO_CSV)
    if (!destino) return
    try {
      const contenido =
        tab === 'evaluaciones'
          ? csvDeEvaluaciones(evaluacionesCronologicas, notasPaciente.anotaciones)
          : csvDeEntrenamientos(entrenamientosCronologicos, notasPaciente.anotaciones)
      await destino.guardar(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
    } catch {
      setErrorExportacion('No se pudo guardar el CSV.')
    }
  }

  async function descargarInforme() {
    if (!token) return
    setErrorExportacion(null)
    // Primero el diálogo de "Guardar como": el navegador sólo lo deja abrir justo después del click.
    const destino = await elegirDestino(`Informe ${paciente.nombre} ${hoyIso}.pdf`, TIPO_PDF)
    if (!destino) return
    setGenerandoInforme(true)
    try {
      const perfilPaciente = (await api.medico.misPacientes(token)).find((p) => String(p.id_paciente) === paciente.id)
      if (!perfilPaciente) throw new Error('No encontramos los datos del paciente.')
      const { generarInformeGeneral } = await import('./pdfInforme')
      const pdf = await generarInformeGeneral({
        paciente: perfilPaciente,
        medico: perfil?.rol === 'medico' ? `${perfil.datos.nombre} ${perfil.datos.apellido}` : '',
        evaluaciones,
        entrenamientos,
        anotaciones: notasPaciente.anotaciones,
      })
      await destino.guardar(pdf)
    } catch (err) {
      setErrorExportacion(err instanceof Error ? err.message : 'No se pudo generar el informe.')
    } finally {
      setGenerandoInforme(false)
    }
  }

  const valoresPim = evaluacionesCronologicas
    .map((e) => e.pim)
    .filter((v): v is number => v != null)
  const pimInicial = valoresPim[0]
  const pimActual = valoresPim[valoresPim.length - 1]

  return (
    <div className="card">
      <div className="detail-title-row">
        <h2>{paciente.nombre}</h2>
        <button
          className="btn-icon btn-icon-pink"
          onClick={() => setConfirmarDesvinculo(true)}
          aria-label="Desvincular paciente"
          title="Desvincular paciente"
        >
          <TrashIcon className="icon-16" />
        </button>
      </div>

      <div className="detail-header">
        <div className="detail-id">
          <div className="p-sub">
            {paciente.edad} años
          </div>
          <div className="tags">
            <span className="tag">Enfermedades: {paciente.enfermedades ?? 'sin informar'}</span>
            <span className="tag">PIM inicial: {pimInicial != null ? `${pimInicial} cmH₂O` : 'sin definir'}</span>
            <span className="tag">PIM actual: {pimActual != null ? `${pimActual} cmH₂O` : 'sin definir'}</span>
            <span className="tag">
              Resistencia actual: {rutina ? `Nivel ${rutina.resistencia_activa}` : 'sin definir'}
            </span>
            {token && (
              <ResistenciaTag token={token} idPaciente={Number(paciente.id)} nombrePaciente={paciente.nombre} />
            )}
            <button
              className="tag tag-clickable"
              onClick={() => setModalFrecuencia(true)}
              title="Modificar frecuencia"
            >
              Frecuencia: {frecuenciaVigente ? `${frecuenciaVigente.sesiones_por_semana}x/semana` : 'sin definir'}
            </button>
          </div>
        </div>
      </div>

      <div className="tabs-row">
        <div className="tabs" role="tablist" aria-label="Detalle clínico del paciente">
          <button className={`tab ${tab === 'evaluaciones' ? 'active' : ''}`} role="tab" aria-selected={tab === 'evaluaciones'} onClick={() => setTab('evaluaciones')}>
            Evaluaciones
          </button>
          <button className={`tab ${tab === 'entrenamiento' ? 'active' : ''}`} role="tab" aria-selected={tab === 'entrenamiento'} onClick={() => setTab('entrenamiento')}>
            Entrenamiento
          </button>
          <button className={`tab ${tab === 'calendario' ? 'active' : ''}`} role="tab" aria-selected={tab === 'calendario'} onClick={() => setTab('calendario')}>
            Calendario
          </button>
        </div>
        {tab === 'calendario' ? (
          <button className="btn btn-outline btn-sm" onClick={() => setModalFrecuencia(true)}>
            Modificar frecuencia
          </button>
        ) : (
          <div className="tabs-row-acciones">
            <button
              className="btn btn-outline btn-sm"
              onClick={descargarCsv}
              disabled={
                notasPaciente.cargando ||
                (tab === 'evaluaciones'
                  ? cargandoEvaluaciones || evaluaciones.length === 0
                  : cargandoEntrenamientos || entrenamientos.length === 0)
              }
              title="Un CSV con los puntos de todos los gráficos de esta pestaña y sus notas"
            >
              Descargar CSV
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={descargarInforme}
              disabled={generandoInforme || cargandoEvaluaciones || cargandoEntrenamientos || notasPaciente.cargando}
              title="PDF con los datos del paciente, sus evaluaciones y entrenamientos a lo largo del tiempo, y las notas"
            >
              {generandoInforme ? 'Generando informe…' : 'Descargar informe'}
            </button>
          </div>
        )}
      </div>
      {errorExportacion && <div className="auth-alert error">{errorExportacion}</div>}
      {errorOcultar && <div className="auth-alert error">{errorOcultar}</div>}

      {tab === 'evaluaciones' && (
        <div role="tabpanel">
          {cargandoEvaluaciones ? (
            <p className="empty-state">Cargando evaluaciones…</p>
          ) : errorEvaluaciones ? (
            <p className="empty-state">{errorEvaluaciones}</p>
          ) : (
            <>
              {evaluacionesCronologicas.length > 0 ? (
                <TrendChartCarousel
                  series={seriesEvaluaciones}
                  anotacionesDe={(serie) => (serie.clave ? notasPaciente.paraGrafico(serie.clave) : undefined)}
                />
              ) : (
                <p className="empty-state">
                  {hayEvaluacionesOcultas
                    ? 'Todas las evaluaciones están ocultas, así que no hay nada para graficar.'
                    : 'Todavía no hay evaluaciones registradas.'}
                </p>
              )}

              {evaluaciones.length > 0 && (
                <div className="table-wrap mt-16">
                  <table>
                    <thead>
                      <tr>
                        <th className="celda-ojo">
                          <span className="sr-only">Ocultar o borrar</span>
                        </th>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>FVC (L)</th>
                        <th>FEV1 (L)</th>
                        <th>PEF (L/min)</th>
                        <th>FIVC (L)</th>
                        <th>FIV1 (L)</th>
                        <th>PIM (cmH₂O)</th>
                        <th>Señales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sesiones.map((sesion) => {
                        const deLaSesion = [sesion.espirometria, sesion.pim].filter((e): e is Evaluacion => e != null)
                        const oculta = deLaSesion.every((e) => e.oculta)
                        return (
                          <tr key={sesion.fecha_hora} className={oculta ? 'fila-oculta' : undefined}>
                            <td className="celda-ojo">
                              <div className="fila-iconos">
                                <BotonOcultar
                                  oculta={oculta}
                                  que="esta evaluación"
                                  onClick={() =>
                                    cambiarOculta('evaluacion', deLaSesion.map((e) => e.id_evaluacion), !oculta)
                                  }
                                />
                                <BotonBorrar
                                  que="esta evaluación"
                                  onClick={() =>
                                    setABorrar({ tipo: 'evaluacion', fechaHora: sesion.fecha_hora, evaluaciones: deLaSesion })
                                  }
                                />
                              </div>
                            </td>
                            <td>{formatearFecha(sesion.fecha_hora)}</td>
                            <td>{formatearHora(sesion.fecha_hora)}</td>
                            <td>{sesion.espirometria?.fvc ?? '—'}</td>
                            <td>{sesion.espirometria?.fev1 ?? '—'}</td>
                            <td>{sesion.espirometria?.pef ?? '—'}</td>
                            <td>{sesion.espirometria?.fivc ?? '—'}</td>
                            <td>{sesion.espirometria?.fiv1 ?? '—'}</td>
                            <td>{sesion.pim?.pim ?? '—'}</td>
                            <td>
                              <div className="table-actions">
                                {sesion.espirometria && (
                                  <button
                                    className="btn btn-outline btn-sm"
                                    onClick={() =>
                                      navigate(`/medico/pacientes/${paciente.id}/evaluaciones/${sesion.espirometria!.id_evaluacion}`)
                                    }
                                  >
                                    {sesion.pim ? 'Espirometría' : 'Inspeccionar'}
                                  </button>
                                )}
                                {sesion.pim && (
                                  <button
                                    className="btn btn-outline btn-sm"
                                    onClick={() =>
                                      navigate(`/medico/pacientes/${paciente.id}/evaluaciones/${sesion.pim!.id_evaluacion}`)
                                    }
                                  >
                                    {sesion.espirometria ? 'PIM' : 'Inspeccionar'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {hayEvaluacionesOcultas && <NotaOcultas />}
            </>
          )}
        </div>
      )}

      {tab === 'entrenamiento' && (
        <div role="tabpanel">
          {cargandoEntrenamientos ? (
            <p className="empty-state">Cargando entrenamientos…</p>
          ) : errorEntrenamientos ? (
            <p className="empty-state">{errorEntrenamientos}</p>
          ) : (
            <>
              {entrenamientosCronologicos.length > 0 ? (
                <TrendChartCarousel
                  series={seriesEntrenamiento}
                  anotacionesDe={(serie) => (serie.clave ? notasPaciente.paraGrafico(serie.clave) : undefined)}
                />
              ) : (
                <p className="empty-state">
                  {hayEntrenamientosOcultos
                    ? 'No hay sesiones para graficar: las ocultas no entran en los gráficos.'
                    : 'Todavía no hay sesiones de entrenamiento registradas.'}
                </p>
              )}

              {entrenamientosCronologicos.length > 0 && <ResistenciaFranja entrenamientos={entrenamientosCronologicos} />}

              {entrenamientos.length > 0 && (
                <div className="table-wrap mt-16">
                  <table>
                    <thead>
                      <tr>
                        <th className="celda-ojo">
                          <span className="sr-only">Ocultar o borrar</span>
                        </th>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>Estado</th>
                        <th>Ciclos</th>
                        <th>Duración</th>
                        <th>Resistencia</th>
                        <th>Modo</th>
                        <th>Sesión</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entrenamientos.map((e) => (
                        <tr key={e.id_entrenamiento} className={e.oculta ? 'fila-oculta' : undefined}>
                          <td className="celda-ojo">
                            <div className="fila-iconos">
                              <BotonOcultar
                                oculta={e.oculta ?? false}
                                que="esta sesión"
                                onClick={() => cambiarOculta('entrenamiento', [e.id_entrenamiento], !e.oculta)}
                              />
                              <BotonBorrar
                                que="esta sesión"
                                onClick={() => setABorrar({ tipo: 'entrenamiento', entrenamiento: e })}
                              />
                            </div>
                          </td>
                          <td>{fmtEntrenamiento.fecha(e, false)}</td>
                          <td>{fmtEntrenamiento.hora(e)}</td>
                          <td>
                            <span className={`entrenamiento-estado estado-${e.estado ?? 'desconocido'}`}>
                              {fmtEntrenamiento.estado(e)}
                            </span>
                          </td>
                          <td>{fmtEntrenamiento.ciclosHechos(e)}</td>
                          <td>{fmtEntrenamiento.duracion(e.duracion_s)}</td>
                          <td>{e.nivel_resistencia ?? fmtEntrenamiento.SIN_DATO}</td>
                          <td>{fmtEntrenamiento.modo(e)}</td>
                          <td>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => navigate(`/medico/pacientes/${paciente.id}/entrenamientos/${e.id_entrenamiento}`)}
                            >
                              Inspeccionar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {hayEntrenamientosOcultos && <NotaOcultas />}
            </>
          )}
        </div>
      )}

      {tab === 'calendario' && (
        <div role="tabpanel">
          <MonthCalendar
            anio={hoy.getFullYear()}
            mes={hoy.getMonth()}
            diasConEvaluacion={new Set(evaluacionPorFecha.keys())}
            diasConEntrenamiento={diasConEntrenamiento}
            historialRecomendaciones={historialParaCalendario}
            hoyIso={hoyIso}
            onClickEvaluacion={(iso) => {
              const e = evaluacionPorFecha.get(iso)
              if (e) navigate(`/medico/pacientes/${paciente.id}/evaluaciones/${e.id_evaluacion}`)
            }}
          />
          <p className="invite-note">
            Los días marcados en rosa son los recomendados para entrenar. La cinta azul indica que
            hubo una evaluación ese día (clickeala para verla); la cinta rosa, que hubo un
            entrenamiento.{' '}
            {frecuenciaVigente
              ? `La frecuencia recomendada actual es de ${frecuenciaVigente.sesiones_por_semana} sesiones por semana; `
              : 'Todavía no hay una frecuencia definida; '}
            podés ajustarla con "Modificar frecuencia".
          </p>
        </div>
      )}

      {modalFrecuencia && (
        <FrequencyModal
          frecuenciaActual={frecuenciaVigente?.sesiones_por_semana ?? 3}
          diasActuales={frecuenciaVigente?.dias_semana ?? []}
          nombrePaciente={paciente.nombre}
          onClose={() => setModalFrecuencia(false)}
          onGuardar={async (nuevaFrecuencia, nuevosDias) => {
            const creada = await api.medico.crearFrecuencia(token!, Number(paciente.id), {
              sesiones_por_semana: nuevaFrecuencia,
              dias_semana: nuevosDias,
            })
            setHistorialFrecuencia((actual) => [creada, ...actual])
          }}
        />
      )}

      {aBorrar && (
        <BorrarMedicionModal
          medicion={aBorrar}
          onBorrar={borrarMediciones}
          onClose={() => setABorrar(null)}
        />
      )}

      {confirmarDesvinculo && (
        <Modal
          titulo="Desvincular paciente"
          onClose={() => setConfirmarDesvinculo(false)}
          acciones={
            <>
              <button
                className="btn btn-outline"
                onClick={() => setConfirmarDesvinculo(false)}
                disabled={desvinculando}
              >
                Cancelar
              </button>
              <button className="btn btn-teal" onClick={confirmarYDesvincular} disabled={desvinculando}>
                {desvinculando ? 'Desvinculando…' : 'Sí, desvincular'}
              </button>
            </>
          }
        >
          <p>
            ¿Desea desvincular a <strong>{paciente.nombre}</strong>? Perderá el acceso a su información clínica.
            Podrá volver a vincularla en cualquier momento utilizando su nombre de usuario y PIN.
          </p>
          {errorDesvinculo && <div className="auth-alert error">{errorDesvinculo}</div>}
        </Modal>
      )}
    </div>
  )
}

/**
 * El ojito de cada fila de las tablas: marca la medición como fallida (ojo
 * tachado, fila en gris) para que no aparezca en los gráficos de evolución,
 * en el CSV ni en el informe.
 */
function BotonOcultar({ oculta, que, onClick }: { oculta: boolean; que: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`btn-ojo ${oculta ? 'btn-ojo-oculta' : ''}`}
      onClick={onClick}
      aria-pressed={oculta}
      aria-label={`Ocultar ${que} de los gráficos y el informe`}
      title={
        oculta
          ? 'Oculta: no aparece en los gráficos, el CSV ni el informe. Tocá para volver a mostrarla.'
          : 'Marcar como fallida: deja de aparecer en los gráficos, el CSV y el informe'
      }
    >
      <EyeIcon tachado={oculta} className="icon-16" />
    </button>
  )
}

function NotaOcultas() {
  return (
    <p className="nota-ocultas">
      Las filas en gris están ocultas: no aparecen en los gráficos, el CSV ni el informe. Tocá el ojo para volver a
      mostrarlas.
    </p>
  )
}

/** Lo que se va a borrar: una fila de evaluaciones (espirometría y/o PIM de una sesión) o un entrenamiento. */
type MedicionABorrar =
  | { tipo: 'evaluacion'; fechaHora: string; evaluaciones: Evaluacion[] }
  | { tipo: 'entrenamiento'; entrenamiento: Entrenamiento }

/** El tacho de cada fila: abre la confirmación para borrar la medición. */
function BotonBorrar({ que, onClick }: { que: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-ojo btn-borrar-fila"
      onClick={onClick}
      aria-label={`Borrar ${que}`}
      title="Borrar (no se puede deshacer)"
    >
      <TrashIcon className="icon-16" />
    </button>
  )
}

const NOMBRE_EVALUACION: Record<Evaluacion['tipo'], string> = { ESPIROMETRIA: 'Espirometría', PIM_PEM: 'PIM' }

/**
 * Confirmación antes de borrar. En una sesión con espirometría y PIM se elige
 * cuáles (vienen las dos marcadas). Avisa que no se puede deshacer y que el
 * dispositivo no la vuelve a cargar aunque la mande de nuevo.
 */
function BorrarMedicionModal({
  medicion,
  onBorrar,
  onClose,
}: {
  medicion: MedicionABorrar
  onBorrar: (tipo: 'evaluacion' | 'entrenamiento', ids: number[]) => Promise<void>
  onClose: () => void
}) {
  const opciones =
    medicion.tipo === 'evaluacion'
      ? medicion.evaluaciones.map((e) => ({ id: e.id_evaluacion, nombre: NOMBRE_EVALUACION[e.tipo] }))
      : [{ id: medicion.entrenamiento.id_entrenamiento, nombre: 'Entrenamiento' }]
  const [elegidas, setElegidas] = useState<number[]>(opciones.map((o) => o.id))
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fechaHora = medicion.tipo === 'evaluacion' ? medicion.fechaHora : medicion.entrenamiento.fecha_hora
  const cuando = fechaHora ? `del ${formatearFecha(fechaHora)} a las ${formatearHora(fechaHora)}` : 'sin fecha'
  const titulo = medicion.tipo === 'evaluacion' ? 'Borrar evaluación' : 'Borrar entrenamiento'

  async function confirmar() {
    setBorrando(true)
    setError(null)
    try {
      await onBorrar(medicion.tipo, elegidas)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo borrar. Probá de nuevo.')
      setBorrando(false)
    }
  }

  return (
    <Modal
      titulo={titulo}
      wide
      onClose={borrando ? () => {} : onClose}
      acciones={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={borrando}>
            Cancelar
          </button>
          <button className="btn btn-red" onClick={confirmar} disabled={borrando || elegidas.length === 0}>
            {borrando ? 'Borrando…' : 'Borrar'}
          </button>
        </>
      }
    >
      <p>
        {medicion.tipo === 'evaluacion' ? 'Sesión de evaluación' : 'Sesión de entrenamiento'} {cuando}. Se borran sus
        valores, su señal y sus notas, y deja de aparecer en los gráficos y el informe.{' '}
        <strong>No se puede deshacer.</strong> Si el dispositivo la vuelve a mandar al sincronizar, la web no la carga de
        nuevo.
      </p>
      {opciones.length > 1 && (
        <div className="borrar-opciones" role="group" aria-label="Qué borrar">
          {opciones.map((o) => (
            <label key={o.id} className="field-check">
              <input
                type="checkbox"
                checked={elegidas.includes(o.id)}
                onChange={(e) =>
                  setElegidas((actuales) => (e.target.checked ? [...actuales, o.id] : actuales.filter((id) => id !== o.id)))
                }
                disabled={borrando}
              />
              <span>{o.nombre}</span>
            </label>
          ))}
        </div>
      )}
      {error && <div className="auth-alert error">{error}</div>}
    </Modal>
  )
}
