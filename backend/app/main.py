import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, migrar_esquema_existente
from app.core.migracion_entrenamientos import migrar_entrenamientos, reingresar
from app.routers import (
    auth,
    dispositivo,
    dispositivo_medico,
    dispositivo_paciente,
    medicos,
    pacientes,
    entrenamientos_medico,
    resistencia_medico,
)
from app.seed import seed_if_empty
from app.seed_entrenamientos import sembrar_si_falta

# Importa todos los modelos (ver app/models/__init__.py) para que
# Base.metadata los conozca antes de crear las tablas.
import app.models  # noqa: F401

app = FastAPI(
    title="Bronquito API",
    description="API para la plataforma web de Bronquito (dispositivo IMT).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(pacientes.router)
app.include_router(medicos.router)
app.include_router(dispositivo.router)
app.include_router(dispositivo_medico.router)
app.include_router(dispositivo_paciente.router)
app.include_router(resistencia_medico.router)
app.include_router(entrenamientos_medico.router)


@app.on_event("startup")
def on_startup() -> None:
    # Crea las tablas si no existen. Para un proyecto que crezca más, esto
    # se reemplaza por migraciones con Alembic (versionar cambios de schema
    # en vez de recrear todo desde los modelos) — ver README del backend.
    # La tabla vieja de entrenamientos se reemplaza antes de crear las nuevas.
    migracion = migrar_entrenamientos(engine)
    Base.metadata.create_all(bind=engine)
    migrar_esquema_existente()

    db = SessionLocal()
    try:
        seed_if_empty(db)
        if migracion.hay_respaldo:
            try:
                reingresar(db)
            except Exception:  # noqa: BLE001 - la API tiene que arrancar igual
                db.rollback()
                logging.getLogger(__name__).exception(
                    "No se pudieron migrar los entrenamientos; el respaldo queda para el próximo arranque."
                )
        if migracion.borrada_original:
            sembrar_si_falta(db)
    finally:
        db.close()


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
