/**
 * Tipos que reflejan lo que la API de Bronquito recibe y devuelve.
 * Mantener en sync con `backend/app/schemas/`.
 */

export type Rol = 'medico' | 'paciente'

export type Sexo = 'F' | 'M' | 'X'

export type EnfermedadPreexistente = 'EPOC' | 'Asma' | 'Lesión Medular' | 'Fibrosis quística' | 'Otra' | 'NS/NC'

export interface TokenOut {
  access_token: string
  token_type: 'bearer'
  rol: Rol
}

export interface RecuperacionOut {
  mensaje: string
}

export interface MedicoPerfil {
  id_medico: number
  usuario: string
  nombre: string
  apellido: string
  fecha_registro: string
}

/** Médico que tiene acceso vigente a la información clínica del paciente. */
export interface MedicoACargo {
  id_medico: number
  nombre: string
  apellido: string
}

export interface PacientePerfil {
  id_paciente: number
  nombre_usuario: string
  nombre: string | null
  apellido: string | null
  email: string | null
  altura_cm: number
  peso_kg: number
  fecha_nacimiento: string
  sexo: string
  fumador: boolean
  enfermedades: string | null
  fecha_registro: string
  acepto_terminos: boolean
}

/** Un paciente en la lista del médico: el perfil más su última sesión. */
export interface PacienteDeMedico extends PacientePerfil {
  /** La evaluación o el entrenamiento más reciente (fecha y hora, sin zona); null si no tiene ninguna. */
  ultima_sesion: string | null
}

export type TipoEvaluacion = 'ESPIROMETRIA' | 'PIM_PEM'

export interface Evaluacion {
  id_evaluacion: number
  tipo: TipoEvaluacion
  fecha_hora: string
  fvc: number | null
  fev1: number | null
  pef: number | null
  fivc: number | null
  fiv1: number | null
  pim: number | null
  temperatura: number | null
  humedad: number | null
  /** Sólo en la vista del médico: la marcaron como fallida (no va en gráficos, CSV ni informe). */
  oculta?: boolean
}

export interface EvaluacionMuestras {
  tiempo: number[]
  flujo: number[]
  presion: number[]
  volumen: number[]
}

/**
 * Una sesión de entrenamiento, con el formato que manda el equipo (ver
 * backend/app/core/entrenamientos_dispositivo.py). Cualquier número puede
 * venir en null ("no se pudo calcular"): se muestra "--", nunca 0.
 *
 * Signos: PIM y PEM vienen como las mide la placa (PIM positiva, PEM
 * negativa). En pantalla van con la convención clínica (ver
 * pages/medico/entrenamiento/formato.ts). `multiciclo.caida_pim_pct` ya viene
 * con el criterio nuevo: > 0 = la PIM cayó.
 */
export interface Entrenamiento {
  id_entrenamiento: number
  archivo: string
  /** Hora local del equipo; null si no tenía hora. */
  fecha_hora: string | null
  duracion_s: number | null
  estado: 'completa' | 'incompleta' | 'interrumpida' | null
  fin: 'objetivo' | 'detenida' | 'sin_respiracion' | 'tiempo_maximo' | null
  ciclos_objetivo: number | null
  n_ciclos_completos: number | null
  /** 1 (válvula más abierta) a 5 (más cerrada). */
  nivel_resistencia: number | null
  modo_resistencia: 'automatico' | 'manual' | null
  dc: number | null
  temperatura_c: number | null
  humedad_rel_pct: number | null
  factor_btps: number | null
  /** JSON de una versión anterior del equipo. */
  formato_anterior: boolean
  /** False si el equipo no pudo analizarla: sin ciclos ni resumen. */
  analizada: boolean
  tiene_senal: boolean
  promedios: PromediosEntrenamiento | null
  multiciclo: MulticicloEntrenamiento | null
  /** Sólo en la vista del médico: la marcaron como fallida (no va en gráficos, CSV ni informe). */
  oculta?: boolean
}

/** Un entrenamiento con fecha: los únicos que se pueden ubicar en la evolución. */
export type EntrenamientoConFecha = Entrenamiento & { fecha_hora: string }

export interface PromediosEntrenamiento {
  ti_s: number | null
  te_s: number | null
  pausa_s: number | null
  ti_ttot: number | null
  pif_Lmin: number | null
  pef_Lmin: number | null
  vol_insp_L: number | null
  vol_esp_L: number | null
  pim_cmH2O: number | null
  pem_cmH2O: number | null
  trabajo_insp_J: number | null
  potencia_insp_W: number | null
}

export interface MulticicloEntrenamiento {
  n_ciclos_completos: number | null
  n_fases_sueltas: number | null
  periodo_medio_s: number | null
  frecuencia_rpm: number | null
  ventilacion_minuto_Lmin: number | null
  trabajo_total_insp_J: number | null
  /** cmH₂O por ciclo, sobre |PIM|: > 0 = la fuerza aumentó. */
  pendiente_pim_por_ciclo: number | null
  /** Último tercio vs. primer tercio: > 0 = la PIM cayó (fatiga). */
  caida_pim_pct: number | null
  pif_max_Lmin: number | null
  pif_max_ciclo: number | null
  pef_max_Lmin: number | null
  pef_max_ciclo: number | null
  pim_max_cmH2O: number | null
  pim_max_ciclo: number | null
  pem_max_cmH2O: number | null
  pem_max_ciclo: number | null
}

export interface CicloEntrenamiento extends PromediosEntrenamiento {
  numero: number | null
  /** Segundos desde el inicio del CSV. */
  t_inicio_s: number | null
  t_fin_s: number | null
  t_pif_s: number | null
  t_pef_s: number | null
  t_pim_s: number | null
  t_pem_s: number | null
}

export interface EntrenamientoDetalle extends Entrenamiento {
  ciclos: CicloEntrenamiento[] | null
}

/**
 * La señal del CSV, sin tocar signos: presión positiva al inspirar, flujo
 * negativo al inspirar.
 */
export interface SenalEntrenamiento {
  tiempo_s: number[]
  presion_cmh2o: number[]
  /** Flujo crudo: sin BTPS, sólo para diagnóstico. Null = celda vacía (hueco). */
  flujo_lmin: (number | null)[]
  /**
   * Flujo PROCESADO por el equipo (sentido por fase, venturi, BTPS y filtro
   * de picos): el mismo de las métricas del JSON. Negativo al inspirar. Null
   * si el CSV no lo trae (equipo viejo) o viene vacío (sesión sin análisis);
   * un null suelto es un hueco.
   */
  flujo_proc_lmin: (number | null)[] | null
}

/** La rutina activa de un paciente ahora mismo. */
export interface Rutina {
  resistencia_activa: number
  tiempo_descanso: number
  repeticiones: number
  modificado_por: 'ALGORITMO' | 'MEDICO'
  fecha_actualizacion: string
}

/** Una entrada del historial de frecuencia/días recomendados de un paciente. */
export interface Frecuencia {
  id_frecuencia: number
  sesiones_por_semana: number
  /** Días de la semana recomendados (0 = lunes ... 6 = domingo). */
  dias_semana: number[]
  vigente_desde: string
  creado_en: string
}

/**
 * Nota de un médico sobre un paciente: en un punto de un gráfico (`grafico` +
 * `punto`), o comentario general de una sesión (`grafico` y `punto` en null).
 * Las claves de `grafico`/`punto` las arma el front (ver anotaciones/useAnotaciones.ts).
 */
export interface Anotacion {
  id_anotacion: number
  id_medico: number
  /** Nombre y apellido del médico que la escribió. */
  autor: string
  /** `fecha_hora` de la sesión de consultorio a la que pertenece, si es de una. */
  sesion: string | null
  grafico: string | null
  punto: string | null
  texto: string
  creado_en: string
  editado_en: string | null
}

// --- Request bodies -------------------------------------------------------

export interface MedicoLoginBody {
  usuario: string
  contrasena: string
}

export interface MedicoRegistroBody {
  usuario: string
  contrasena: string
  nombre: string
  apellido: string
  acepto_terminos: boolean
}

export interface PacienteLoginBody {
  nombre_usuario: string
  pin: string
}

export interface PacienteRegistroBody {
  nombre_usuario: string
  pin: string
  nombre: string
  apellido: string
  email: string
  altura_cm: number
  peso_kg: number
  fecha_nacimiento: string
  sexo: Sexo
  fumador: boolean
  enfermedades: EnfermedadPreexistente[]
  acepto_terminos: boolean
}

export interface PacientePerfilUpdateBody {
  nombre_usuario?: string
  pin?: string
  nombre?: string
  apellido?: string
  email?: string
  altura_cm?: number
  peso_kg?: number
  fecha_nacimiento?: string
  sexo?: Sexo
  fumador?: boolean
  enfermedades?: EnfermedadPreexistente[]
  acepto_terminos?: boolean
}

export interface MedicoPerfilUpdateBody {
  usuario?: string
  nombre?: string
  apellido?: string
  nueva_contrasena?: string
}

export interface FrecuenciaCrearBody {
  sesiones_por_semana: number
  /** Días de la semana recomendados (0 = lunes ... 6 = domingo). */
  dias_semana: number[]
}

export interface AnotacionCrearBody {
  texto: string
  sesion?: string | null
  grafico?: string | null
  punto?: string | null
}
