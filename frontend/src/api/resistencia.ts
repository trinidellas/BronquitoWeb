/**
 * Resistencia de la válvula y valores predichos que viajan al equipo. Ver
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

export interface ConfiguracionEquipo {
  resistencia: ConfiguracionResistencia | null
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
  elegirEcuacion: (token: string, idPaciente: number, sexo: 'M' | 'F') =>
    apiFetch<ConfiguracionEquipo>(`${base(idPaciente)}/ecuacion-predichos`, {
      method: 'PUT',
      body: { sexo_ecuacion: sexo },
      token,
    }),
}
