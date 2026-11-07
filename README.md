# Bronquito

Página web del Bronquito, el dispositivo portátil para entrenar y evaluar los músculos inspiratorios (IMT). Es parte del proyecto de Instrumentación Biomédica.

La usan pacientes y médicos:

- Los pacientes se registran con un nombre de usuario y un PIN de 4 dígitos. Desde la web ven sus evaluaciones y entrenamientos, la frecuencia que les recomendó el médico y quiénes son sus médicos. También pueden editar sus datos y ver los videos tutoriales.
- Los médicos se registran con mail y contraseña. Para vincular a un paciente tienen que poner su usuario y su PIN. Pueden ver los gráficos de cada evaluación, dejar notas en los gráficos o en una sesión, cambiar la frecuencia recomendada y exportar los datos a PDF o CSV.
- Desde la web el médico también maneja el dispositivo: le asigna un paciente, lo formatea o le cambia el usuario. La ESP32 se conecta a la API por WiFi, levanta esos pedidos y sube las pruebas que tiene guardadas en la microSD.
- Si alguien se olvida la contraseña o el PIN, le llega un mail con un link para cambiarlo.

## Estructura

```
frontend/            React + TypeScript + Vite
backend/             Python + FastAPI (la API)
docker-compose.yml   levanta la web, la API y MySQL
levantar.sh          script para levantar todo
DISPOSITIVO.md       cómo se comunica la ESP32 con la API
```

## Cómo levantarlo

Hace falta tener Docker Desktop instalado y abierto.

1. Copiar el archivo de variables de entorno:

   ```bash
   cp .env.example .env
   ```

   En el `.env` hay que completar los datos del mail (`SMTP_USER`, `SMTP_PASSWORD`) y la `DEVICE_API_KEY`, que tiene que ser la misma clave que tiene cargada el firmware de la ESP.

2. Levantar todo desde la carpeta raíz:

   ```bash
   ./levantar.sh --build
   ```

   El `--build` va la primera vez o cuando cambiás código. Si no, alcanza con `./levantar.sh`.

3. Abrir:
   - http://localhost:5173 para la web
   - http://localhost:8000/docs para la documentación de la API

El script detecta la IP de la compu en la red y se la pasa a la API. El último número de esa IP es el código que hay que poner en la ESP para que se conecte, y en la web aparece en "Conectar a dispositivo". La compu y la ESP tienen que estar en la misma red WiFi. En la facultad no funciona porque la red bloquea la conexión entre equipos, así que usamos el hotspot del celular.

Si no vas a usar la ESP, también se puede levantar con `docker compose up --build`, pero así la web no muestra el código.

Como el script deja todo corriendo de fondo, los logs se ven con `docker compose logs -f api`. Para apagar todo: `docker compose down`. Con `docker compose down -v` además se borra la base de datos.

## Usuarios de prueba

La primera vez que arranca con la base vacía, la API crea las tablas y carga datos de ejemplo (`backend/app/seed.py`):

- Médico: `belen.fernandez@bronquito.app` / `medico1234`
- Pacientes (usuario / PIN): `msalerno` / `1234`, `therrera` / `5678`, `rfernandez` / `4321`

## Ver la base de datos

Con todo levantado:

```bash
docker compose exec db mysql --default-character-set=utf8mb4 -ubronquito -p bronquito
```

Pide la `MYSQL_PASSWORD` del `.env`. Ojo que la tabla de pacientes se llama `usuarios`.

También se puede ver desde VS Code con la extensión SQLTools. La conexión ya está configurada en `.vscode/settings.json`.

## Más info

- `DISPOSITIVO.md`: los mensajes entre la ESP32 y la API.
- `backend/README.md`: las tablas, los endpoints y cómo se mandan los mails.
