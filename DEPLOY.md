# Publicar la app

> **Qué está verificado y qué no.** Probé el servidor en producción de forma local (proceso real, cierre ordenado, compresión,
> límites, cabeceras) y verifiqué que los archivos que copia el `Dockerfile` bastan para arrancar. **No pude construir la imagen
> ni probar ninguna plataforma** (esta sesión no tiene motor de Docker ni cuentas de hosting): `Dockerfile`, `render.yaml`,
> `fly.toml` y `docker-compose.yml` son plantillas razonables que debes comprobar contra la documentación vigente de cada servicio.
> Después de publicar, `node scripts/smoke.js https://tu-dominio.com --chat` te dice qué funciona de verdad.

## 1. Antes de publicar (lista corta)

- [ ] **Revoca las claves que hayas pegado en chats o correos** y crea nuevas. Las claves solo van en variables de entorno del servidor.
- [ ] **Fija un límite de gasto en cada proveedor de pago** (OpenAI, Anthropic): cada mensaje de un usuario anónimo lo pagas tú.
- [ ] Define `OPERATOR` (tu nombre y un contacto): aparece en `/privacidad.html`.
- [ ] Decide qué claves poner. **Solo `GEMINI_API_KEY`** = gratis, con límites de cuota, y sin «Crear imagen». Añadir `OPENAI_API_KEY` activa
      la creación de imágenes (de pago). Deja sin definir las claves de cuentas sin saldo: así la app no ofrece funciones que fallan.
- [ ] `TRUST_PROXY=1` (casi todos los hostings ponen un proxy delante; sin esto todos los usuarios comparten IP en los límites).
- [ ] Sirve por **HTTPS** (sin él no funcionan la instalación como app, el portapapeles ni el service worker).

## 2. Variables que importan

| Variable | Para qué |
|---|---|
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Claves (una o varias). Orden: OpenAI > Claude > Gemini; los demás son respaldo |
| `OPERATOR` | Responsable del servicio, visible en la página de privacidad |
| `TRUST_PROXY=1` | Usar la IP real del visitante y activar HSTS |
| `PORT` | Puerto (la mayoría de plataformas lo definen solas) |
| `RATE_PER_MINUTE`, `RATE_PER_DAY`, `RATE_GLOBAL_PER_DAY` | Topes de uso del chat. **Ponlos por debajo de la cuota real de tu proveedor** |
| `IMAGE_PER_DAY`, `IMAGE_GLOBAL_PER_DAY` | Topes de imágenes (cuestan dinero) |

La lista completa está en `.env.example`.

## 3. Opciones de hosting

| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **PaaS con Docker** (Render, Fly.io, Railway…) | Poco mantenimiento, HTTPS incluido | Los planes gratuitos suelen **dormirse** tras un rato sin visitas (la primera carga tarda) o tener horas limitadas. Revisa precios y límites vigentes |
| **VPS propio + `docker compose` + Caddy** | Siempre activo, control total, HTTPS automático | Lo administras tú (actualizaciones del sistema) y suele tener un costo mensual |
| **Node directo** (`npm start` con systemd o pm2) | Lo más simple | Debes poner tú un proxy con HTTPS delante |

**Una sola instancia.** Los límites por IP viven en la memoria del proceso. Si ejecutas varias réplicas, cada una cuenta por separado
y el límite efectivo se multiplica; para escalar habría que mover los contadores a Redis (no está hecho).

### Render / Fly.io (plantillas incluidas)
1. Sube el proyecto a un repositorio **sin el archivo `.env`** (ya está en `.gitignore`).
2. Crea el servicio apuntando al `Dockerfile` (`render.yaml` y `fly.toml` son el punto de partida).
3. Define las claves como *secretos* de la plataforma (no en los archivos): en Fly, `fly secrets set GEMINI_API_KEY=...`.
4. Comprueba que el chequeo de salud use `/api/health`.

### VPS con HTTPS automático
```bash
cp .env.example .env        # completa claves, OPERATOR, etc.
# edita Caddyfile: cambia tu-dominio.com por tu dominio (su DNS debe apuntar a tu servidor)
docker compose up -d --build
```
`Caddyfile` ya desactiva la compresión del proxy y vacía el búfer (`flush_interval -1`), necesario para que las respuestas lleguen en streaming.

## 4. Verificar el despliegue
```bash
node scripts/smoke.js https://tu-dominio.com --chat
```
Comprueba: página, cabeceras de seguridad, HSTS, claves configuradas, compresión, PWA, que el proxy deje pasar las peticiones POST,
la página de privacidad, y con `--chat` hace **una** pregunta real y confirma que la respuesta llega en streaming.

## 5. Operar
- **Registros:** el servidor solo escribe arranque, cierre y errores; **nunca el contenido de los mensajes**.
- **Actualizar la app:** sube los cambios y cambia `VERSION` en `public/sw.js`: los usuarios verán el aviso «Hay una versión nueva».
- **Reinicios:** el servidor atiende `SIGTERM` y deja terminar las respuestas en curso (hasta 10 s).
- **Cuotas:** vigila el consumo en el panel de cada proveedor. Si se agota el saldo de OpenAI/Claude, la app pasa sola al siguiente proveedor.
- **No hay base de datos ni copias de seguridad que hacer:** el historial vive en el dispositivo de cada usuario.

## 6. Si algo falla
| Síntoma | Causa probable |
|---|---|
| La respuesta aparece de golpe, no poco a poco | Un proxy acumula la respuesta. Desactiva el *buffering* para `/api/chat` (en Nginx, `proxy_buffering off;`). `smoke.js --chat` lo detecta |
| Todos los usuarios reciben «límite alcanzado» a la vez | Falta `TRUST_PROXY=1`: el servidor ve una sola IP (la del proxy) |
| No aparece «Instalar app» | Falta HTTPS, o el navegador (iPhone: Compartir → «Añadir a pantalla de inicio») |
| «El servicio se quedó sin saldo» | Sin créditos en OpenAI/Claude; con otra clave configurada, la app usa el respaldo |
| El chat dice que falta la clave | Ninguna de las claves está definida en el servidor |
| Primera carga lentísima | Plan gratuito dormido; el primer visitante «despierta» el servicio |
