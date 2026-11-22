/**
 * Resistencia de la válvula, repeticiones por sesión y valores predichos que viajan al equipo. Ver
 * backend/app/routers/resistencia_medico.py.
 *
 * La web sólo fija el modo (automático / manual) y el nivel manual. El nivel
 * automático lo calcula y lo guarda el equipo: la web no lo conoce.
 */

import { apiFetch } from './client'

export type ModoResistencia = 'automatico' | 'manual'

export interface ConfiguracionResistencia {
  id_resistencia: number
  modo: ModoResistencia
  nivel_manual: number
  enviado: string
  creado_en: string
  /** Null hasta que el equipo sincroniza y avisa que la guardó. */
  confirmada_en: string | null
}

/** Cuántas repeticiones (respiraciones contra la válvula) pide el equipo en cada sesión. */
export interface ConfiguracionRepeticiones {
  id_repeticiones: number
  repeticiones: number
  enviado: string
  creado_en: string
  /** Null hasta que el equipo sincroniza y avisa que la guardó. */
  confirmada_en: string | null
}

export const REPETICIONES_MIN = 1
export const REPETICIONES_MAX = 30

export interface ConfiguracionEquipo {
  resistencia: ConfiguracionResistencia | null
  /** Null si el médico todavía no las fijó (el equipo usa las suyas). */
  repeticiones: ConfiguracionRepeticiones | null
  sexo: string
  /** 'M' / 'F' que se usa para los predichos; null en un paciente "X" sin elegir. */
  sexo_ecuacion: 'M' | 'F' | null
  predichos: { fvc_predicha_L: number | null; pim_predicha_cmh2o: number | null }
  frecuencia_confirmada: boolean | null
}

const base = (idPaciente: number) => `/medicos/me/pacientes/${idPaciente}`

export const apiResistencia = {
  ver: (token: string, idPaciente: number) =>
    apiFetch<ConfiguracionEquipo>(`${base(idPaciente)}/configuracion-equipo`, { token }),
  fijar: (token: string, idPaciente: number, modo: ModoResistencia, nivelManual: number) =>
    apiFetch<ConfiguracionEquipo>(`${base(idPaciente)}/resistencia`, {
      method: 'POST',
      body: { modo, nivel_manual: nivelManual },
      token,
    }),
  fijarRepeticiones: (token: string, idPaciente: number, repeticiones: number) =>
    apiFetch<ConfiguracionEquipo>(`${base(idPaciente)}/repeticiones`, {
      method: 'POST',
      body: { repeticiones },
      token,
    }),
  elegirEcuacion: (token: string, idPaciente: number, sexo: 'M' | 'F') =>
    apiFetch<ConfiguracionEquipo>(`${base(idPaciente)}/ecuacion-predichos`, {
      method: 'PUT',
      body: { sexo_ecuacion: sexo },
      token,
    }),
}
