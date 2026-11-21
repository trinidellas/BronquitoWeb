"""
Importa las 9 tablas del documento de arquitectura en un solo lugar, para
que `Base.metadata.create_all()` (en app/main.py) las conozca a todas al
crear las tablas, y para que las relaciones declaradas como strings
(ej. "MedicoPaciente") se puedan resolver sin problema.
"""

from app.models.anotacion import Anotacion
from app.models.configuracion_dispositivo import (
    ConfiguracionRepeticiones,
    ConfiguracionResistencia,
    EcuacionPredichos,
    FrecuenciaConfirmada,
)
from app.models.dispositivo import ArchivoDispositivo, Dispositivo, RegistroSync, SolicitudDispositivo
from app.models.entrenamiento import CicloEntrenamiento, Entrenamiento, EntrenamientoCsv, EntrenamientoJson
from app.models.evaluacion import Evaluacion, EvaluacionMuestra
from app.models.frecuencia_recomendada import FrecuenciaRecomendada
from app.models.medico import Medico
from app.models.medico_paciente import MedicoPaciente
from app.models.nota_medica import NotaMedica
from app.models.paciente import Paciente
from app.models.rutina import Rutina

__all__ = [
    "Paciente",  # tabla usuarios
    "Medico",  # tabla medicos
    "MedicoPaciente",  # tabla medico_paciente
    "Evaluacion",  # tabla evaluaciones
    "EvaluacionMuestra",  # tabla evaluaciones_muestras
    "Entrenamiento",  # tabla entrenamientos
    "CicloEntrenamiento",  # tabla ciclos_entrenamiento (una fila por ciclo)
    "EntrenamientoCsv",  # tabla entrenamientos_csv (señal de cada sesión)
    "EntrenamientoJson",  # tabla entrenamientos_json (JSON original, respaldo)
    "Rutina",  # tabla rutina
    "NotaMedica",  # tabla notas_medicas
    # No es una de las 9 tablas del documento de arquitectura — es exclusiva
    # de la web, no la sincroniza el dispositivo.
    "FrecuenciaRecomendada",  # tabla frecuencia_recomendada
    "Anotacion",  # tabla anotaciones (notas de los médicos en gráficos/sesiones)
    # Conexión con la ESP (ver app/models/dispositivo.py).
    "Dispositivo",  # tabla dispositivo
    "SolicitudDispositivo",  # tabla solicitudes_dispositivo
    "RegistroSync",  # tabla registro_sync
    "ArchivoDispositivo",  # tabla archivos_dispositivo (pruebas subidas desde la SD)
    # Configuración que viaja al equipo (ver app/models/configuracion_dispositivo.py).
    "ConfiguracionResistencia",  # tabla configuracion_resistencia
    "ConfiguracionRepeticiones",  # tabla configuracion_repeticiones
    "FrecuenciaConfirmada",  # tabla frecuencia_confirmada
    "EcuacionPredichos",  # tabla ecuacion_predichos
]
