# Asistente de IA

Chat con IA real, sin registro, con historial local, imágenes y PWA. El navegador nunca ve las claves:
todas las llamadas a los modelos pasan por el servidor.

```
navegador (public/)  ──/api/chat, /api/image──▶  server.js  ──▶  OpenAI  (principal; único que crea imágenes)
   historial + imágenes locales                  límites, validación,  ├─▶  Claude (Anthropic)
   Markdown + KaTeX                              CSP, streaming SSE    └─▶  Gemini
                                                 (los dos últimos, como proveedor alterno o respaldo)
```

## Puesta en marcha

Requiere Node 18 o superior. No hay dependencias que instalar.

```bash
cp .env.example .env        # pega una o varias claves: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
npm run check-key           # prueba real de tus claves y modelos
npm run check-key -- --images   # además crea 1 imagen de prueba (cuesta unos centavos en OpenAI)
npm start                   # http://localhost:3000
```

Con varias claves, el principal es el primero en el orden OpenAI > Claude > Gemini y los demás son respaldo en cadena.
Con una sola, se usa esa. Para cambiar de proveedor basta una línea en `.env` (`AI_PROVIDER=anthropic`), sin tocar el código.
**Claude no crea imágenes**: esa función exige tener `OPENAI_API_KEY`.

## Qué funciona

| Función | Estado |
|---|---|
| Chat en streaming con contexto, detener, regenerar, copiar, reintentar, reconexión automática | ✅ probado con **Gemini real** y con simulacros |
| Fórmulas (KaTeX), tablas, listas, código con botón Copiar | ✅ probado con Gemini real (respuesta con LaTeX) |
| **Analizar imágenes** (describir, leer texto/OCR, diagramas, ejercicios fotografiados) | ✅ probado con **Gemini real** (leyó el texto de una imagen). Con OpenAI, solo con simulacro |
| Adjuntar JPG/PNG/WEBP por botón, **pegando** o **arrastrando**; vista previa; hasta 4 por mensaje | ✅ probado en navegador |
| **Crear imágenes** y **editar** imágenes (cambiar fondo, quitar/agregar objetos, estilos, colores…) con descarga y visor | ⚠️ probado **solo con un OpenAI simulado**; falta tu prueba con una clave real |
| Respaldo en cadena (OpenAI → Claude → Gemini) si un proveedor se queda sin saldo o está saturado; si «Pro» está saturado, usa el modelo rápido y avisa | ✅ probado (OpenAI sin saldo → Gemini real) |
| **Claude** como proveedor (chat en streaming, visión) | ⚠️ probado **solo con un Claude simulado**; falta una prueba con tu clave de Anthropic |
| Historial local: crear, buscar, renombrar, eliminar (también borra sus imágenes) | ✅ |
| Selector de modelo (Asistente / Asistente Pro) | ✅ |
| **Leer documentos**: Word (.docx), PDF, Excel (.xlsx), CSV, PowerPoint (.pptx), TXT/MD/JSON; hasta 3 por mensaje, con resumen, preguntas, traducción, corrección, extracción | ✅ probado con **Gemini real** (resumen de un Word, total de una hoja de Excel) |
| **PDF escaneados**: las primeras 4 páginas se envían como imágenes y el modelo las lee con visión (OCR) | ✅ probado con **Gemini real** (leyó cliente y monto de un escaneo) |
| **Crear archivos**: botón de descarga en cada respuesta → Word, PDF, Excel (desde sus tablas, con fórmulas), PowerPoint o Markdown; opción **APA 7** (Word y PDF) | ✅ probado con **Gemini real** y los archivos validados con python-docx, openpyxl, python-pptx, pypdf y LibreOffice |
| **Editar un Word existente** («corrígelo», «tradúcelo», «reescribe…») conservando tablas, imágenes, encabezados, márgenes y estilos | ✅ probado con **Gemini real**: solo cambió el párrafo con el error; las demás partes del .docx quedaron idénticas byte a byte |
| Dictado por voz (si el navegador lo ofrece) | ✅ sin probar con micrófono real |
| Límites anti-abuso por IP, límites propios y más estrictos para imágenes, tope global diario | ✅ |
| PWA: instalable, abre la interfaz sin conexión, aviso de actualización | ✅ |
| Página de privacidad y botón para borrar todos los datos locales | ✅ |

**No incluido:** ejecución de código en un entorno aislado (requiere un sandbox del lado del servidor; no se hizo para no
introducir un riesgo de seguridad sin poder aislarlo bien), gráficos dentro de los Excel generados, y edición de PDF.

### Límites reales de los documentos

- **Solo formatos modernos**: `.doc`, `.xls` y `.ppt` antiguos se rechazan con un aviso (guárdalos como .docx/.xlsx/.pptx).
  Los PDF con contraseña también se rechazan.
- **Documentos extensos**: se envía como máximo el principio de cada documento (≈120 000 caracteres) y se avisa. Pide resúmenes por partes.
- **Escaneos**: solo las primeras 4 páginas, y cada imagen cuenta dentro del máximo de 4 imágenes por mensaje.
- **Editar Word**: se modifican los **párrafos del cuerpo y de las tablas**. Encabezados, pies, notas al pie y cuadros de texto **no**
  se editan. Un párrafo modificado conserva su estilo y el formato de su primer tramo, pero **pierde el formato parcial interno**
  (una palabra en negrita dentro de la frase). Los párrafos sin cambios quedan intactos. No se pueden añadir ni borrar párrafos.
  El modelo decide qué cambiar: **revisa el resultado** antes de usarlo.
- **PDF generado**: usa fuentes estándar, es decir, solo caracteres latinos (acentos, ñ, comillas). Alfabetos no latinos y emojis se sustituyen por «?» o se omiten.
- **Fórmulas matemáticas** en Word/PDF salen como texto Unicode legible (`(p - c)/p`, `√(b² - 4ac)`), **no** como ecuaciones editables.
- **APA 7**: aplica la tipografía (Times New Roman 12, doble espacio, sangría, numeración arriba a la derecha, títulos por niveles,
  Referencias con sangría francesa y en página nueva). **No incluye portada** y el modelo **puede inventar referencias**: verifícalas siempre.
- **Excel generado**: cada tabla de la respuesta es una hoja; detecta números, porcentajes y monedas (`1,5` → 1.5) y deja las fórmulas escritas con `=`
  (Excel las calcula al abrir). Sin gráficos ni formatos avanzados.
- Todo se procesa en el navegador (los archivos no pasan por el servidor para leerse). Las librerías pesadas (~4 MB: pdf.js, ExcelJS, pdf-lib, PptxGenJS, JSZip)
  se descargan solo la primera vez que se usan y quedan en caché.

### Lo que NO puede hacer «mejorar nitidez / resolución»

Se envía como una instrucción de edición al modelo de imágenes: **reinterpreta** la imagen, no la amplía con
fidelidad (puede cambiar detalles). Un escalado fiel necesitaría otro tipo de modelo. Lo mismo con «quitar el fondo»:
el modelo puede alterar el sujeto; el servidor pide PNG transparente cuando detecta esa intención.

## Costos y límites reales (léelo antes de publicar)

- **«ChatGPT Plus» no da acceso a la API.** La API de OpenAI es un servicio aparte en `platform.openai.com`,
  con saldo propio y cobro por uso. **Cada mensaje y cada imagen de tus usuarios anónimos lo pagas tú.** Revisa los
  precios vigentes; las imágenes son lo más caro, por eso tienen límites propios (`IMAGE_PER_DAY`…, por defecto 10 por
  IP y 200 en total al día) y el modo imagen se apaga tras cada uso.
- **No existe una copia del modelo de OpenAI que funcione sin ellos.** Si dejas de pagar, la app sigue funcionando
  con el respaldo (Claude, que también cobra por uso, o Gemini gratuito con límites), pero **sin crear ni editar imágenes**.
- **Crear imágenes no tiene opción gratuita** (comprobado: con una clave gratuita de Gemini, los modelos de imágenes "Nano Banana" responden `429`, cuota 0).
  Sin saldo en OpenAI, deja `OPENAI_API_KEY` **sin definir**: la app solo muestra el botón «Crear o editar imagen» cuando hay una clave de OpenAI, y analizar imágenes sigue funcionando con Gemini.
- **La API de Anthropic es distinta de claude.ai**: se obtiene la clave en `console.anthropic.com`, con saldo propio y cobro por uso.
- **La cuota gratuita de Gemini se comparte entre todos tus usuarios.** Cuando se agota, el chat deja de responder hasta
  que se renueva. En la prueba real, el modelo «Pro» a veces devolvía 503 por saturación; la app lo degrada al rápido.
  Los modelos `gemini-2.5-*` ya no se ofrecen a cuentas nuevas: por eso los valores por defecto usan alias `-latest`.
- El nivel gratuito de Google puede usar los datos enviados para mejorar sus productos (lo dice `/privacidad.html`).
- Los topes por IP son en memoria: se reinician con el servidor y varias personas tras una misma red comparten IP.
  No sustituyen a un control de gasto en el proveedor: **configura un límite mensual en tu cuenta de OpenAI**.
- Necesitas un servidor Node con enlace público. Los planes gratuitos suelen «dormirse» tras un rato sin uso.
- La IA **no funciona sin internet**. Sin conexión solo abre la interfaz y el historial guardado.

## Publicar

**Guía completa: [DEPLOY.md](DEPLOY.md)** (lista previa, opciones de hosting, plantillas para Docker, Render, Fly.io y VPS con HTTPS, y `node scripts/smoke.js` para verificar el resultado).
Resumen:

1. Sube la carpeta a tu hosting Node y define las variables de `.env.example` en su panel (no subas `.env`).
2. Si está detrás de un proxy o balanceador (casi todos), pon `TRUST_PROXY=1`; si no, todos compartirán la misma IP en los límites.
3. Sirve la app por **HTTPS** (requisito de service worker, instalación y portapapeles).
4. Define `OPERATOR` (tu nombre y un contacto) en las variables del servidor: aparece en `/privacidad.html`. Sin él, la página conserva un marcador entre corchetes.
5. Al publicar cambios en `public/`, sube `VERSION` en `public/sw.js` para que los usuarios reciban el aviso de actualización.

En iPhone/iPad no existe el botón «Instalar app»: se instala con Compartir → «Añadir a pantalla de inicio».

## Seguridad y privacidad

- Las claves solo viven en el servidor; hay pruebas automáticas que verifican que no aparecen en ninguna respuesta ni archivo.
- Validación de entrada: formato, tamaños, número de mensajes. Las imágenes se validan por sus **primeros bytes** (no por la
  extensión ni el tipo declarado): un ejecutable renombrado a `.png` o un SVG se rechazan; máximo 6 por conversación y 5 MB cada una.
- En el navegador, las imágenes se reescalan (máx. 2048 px) y se **recodifican antes de enviarse**, lo que elimina metadatos
  como la ubicación EXIF (probado).
- Solo se reenvían las imágenes y documentos de los 2 últimos mensajes que los tienen (ahorra costo y datos).
- El texto de un documento llega al modelo dentro de etiquetas `<documento>` y se le indica que son **datos, no instrucciones**
  (defensa contra inyección de instrucciones en el archivo). El texto no puede cerrar la etiqueta ni inyectar atributos en el nombre (probado).
  Aun así, **no es una garantía absoluta**: no adjuntes documentos de origen no confiable si el resultado se usa para decisiones importantes.
- Comprobación de `Origin`, CSP estricta, cabeceras de seguridad. El texto del modelo se escapa; los enlaces solo admiten http, https y mailto.
- Las llamadas a OpenAI se hacen con `store: false`. El servidor no guarda mensajes ni imágenes en disco ni en registros.
- Las imágenes viven en el dispositivo del usuario (IndexedDB) y se borran al eliminar el chat o desde la página de privacidad.

## Pruebas

```bash
npm test                      # 57 pruebas del backend (proveedores simulados, producción, compresión, cierre ordenado)
node test/e2e.js              # 21 pruebas de chat en Chromium real (requiere Playwright)
node test/e2e-images.js       # 18 pruebas de imágenes en Chromium real
node test/e2e-docs.js         # 13 pruebas de documentos; valida los archivos con python-docx/openpyxl/python-pptx/pypdf
node test/e2e-update.js       # flujo de actualización de la PWA
npm run test:real             # prueba con un modelo REAL (usa tu GEMINI_API_KEY; ~8 peticiones)
```

Los simulacros (`test/mock-*.js`) imitan a OpenAI y Gemini. Verifican toda la lógica de la app, pero **no la calidad ni el
comportamiento real de OpenAI**: eso depende de tu clave y de que su documentación actual coincida con lo implementado
(la sesión donde se escribió no pudo consultarla). Usa `npm run check-key -- --images` para confirmarlo.

## Estructura

```
server.js               servidor HTTP: estáticos, /api/chat (SSE), /api/image
lib/providers/          openai.js, anthropic.js, gemini.js e index.js (principal, cadena de respaldo, degradación)
lib/images.js           validación de imágenes por contenido
lib/limits.js           límites anti-abuso
lib/prompt.js           instrucciones del sistema
public/                 la app: app.js (interfaz), docs.js (leer documentos), export.js (crear/editar archivos), sw.js, manifest
public/vendor/          KaTeX, JSZip, ExcelJS, pdf.js, pdf-lib, PptxGenJS (licencias MIT/Apache incluidas)
scripts/check-key.js    prueba real de claves y modelos
test/                   pruebas del backend y de navegador; test/fixtures = archivos reales de prueba (make-fixtures.py los regenera)
```
