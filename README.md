# FRAP Digital — versión local (sin servidor)

App de registro de atención prehospitalaria de Cruz Roja Mexicana Huatulco.
**Ya no necesita dominio, hosting ni base de datos**: todo se guarda en el teléfono y los registros se envían a un grupo de Telegram.

## Qué hace ahora
| Antes (servidor) | Ahora (en el teléfono) |
|---|---|
| Login con usuario y contraseña en MySQL | Perfil local: nombre + rol (paramédico / operador). Varios perfiles por teléfono. |
| Folio consecutivo en MySQL | Folio local `CRM-2026-OCV-A7-0001` (iniciales + 2 caracteres del teléfono + contador). No se repite entre teléfonos. |
| PDF de la FRAP con Dompdf | PDF generado en el teléfono (texto real, firmas, mapa, signos vitales y PAM). |
| Telegram desde PHP | Telegram directo desde la app. Sin señal, queda en una **bandeja de envíos** y se manda sola al volver el internet. |
| Guardias, servicios, checklist | Igual, guardados en el teléfono. Historial y horas del mes en `Historial`. |
| Reportes del panel admin / bot con comandos | **No existen.** El grupo de Telegram es el archivo central. |

## Puesta en marcha

### 1. Bot y grupo de Telegram (una sola vez)
1. En Telegram habla con **@BotFather** → `/newbot` → guarda el **token**.
2. Crea un grupo **privado**, agrega al bot y escribe cualquier mensaje.
3. Abre en el navegador `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número `chat.id` (empieza con `-100`).
4. Revoca el token del bot **anterior** en BotFather (`/revoke`) y rota el de Twilio: estuvieron en el `.env` que viajó en el zip.

### 2. Código de vinculación
Abre `tools/codigo-vinculacion.html` en cualquier navegador (funciona sin internet), pega token e id del grupo y genera el **QR** y el código `FRAP1:…`.
Cada teléfono lo escanea en **Ajustes → Telegram**. El token **no** queda en GitHub ni dentro del APK: vive solo en los teléfonos vinculados.

### 3. Compilar el APK con GitHub
1. Crea un repositorio **privado** y sube todo este proyecto (el `.gitignore` ya excluye llaves, `.sql` y respaldos).
2. Pestaña **Actions → Compilar APK (Android) → Run workflow**. Tarda ~10 min.
3. Descarga el artefacto `FRAP-Digital-APK` (`FRAP-Digital.apk` y `.aab`).
4. **Primera vez:** el flujo crea la llave de firma y la entrega en el artefacto `LLAVE-DE-FIRMA-GUARDAR-Y-NO-COMPARTIR`.
   Guárdala **fuera de GitHub** (respaldo) y crea en *Settings → Secrets and variables → Actions* los secretos
   `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` con los valores de ese artefacto.
   Sin esa llave no podrás actualizar la app ya instalada. Ya no la pierdas.
5. Instala el APK en los teléfonos (o compártelo por Telegram/WhatsApp).

Opcional: variable `VERSION_CODE_BASE` (Settings → Variables) para que el número de versión supere al de la app anterior si la subes a Play Store.

### 4. iPhone
El flujo **Publicar versión web** (GitHub Pages) deja la app instalable desde Safari ("Añadir a pantalla de inicio"). Actívalo en *Settings → Pages → Source: GitHub Actions*. (Pages con repositorio privado requiere plan de pago; si no, usa un repositorio público **solo con este código** — nunca con datos.)

## Respaldo de la base de datos anterior
```
python3 tools/respaldo_bd.py respaldo.sql respaldo/
```
Genera CSV por tabla y `historial.xlsx`. **No** exporta contraseñas. Contiene datos de pacientes: guárdalo en un lugar privado.

## Límites a tener presentes
- Los datos viven en cada teléfono: si se borra la app o se cambia de teléfono, se pierden salvo que uses **Ajustes → Exportar respaldo** (los PDF ya enviados siguen en el grupo de Telegram).
- Quien extraiga el token de un teléfono vinculado puede escribir al bot. Usa un bot dedicado, grupo privado y rótalo (`/revoke`) si un teléfono se pierde; luego vuelve a vincular.
- Las horas de guardia son por teléfono; el total institucional se ve en los avisos del grupo.
- Los QR de guardia deben contener el texto `Base_...` como antes.

## Estructura
```
www/                 la app (HTML/JS). local-core.js = "servidor" interno; frap-pdf.js = PDF
android-overlay/     MainActivity (barras de estado y teclado)
scripts/             preparar-vendor.mjs, aplicar-android.py
tools/               codigo-vinculacion.html (+qrgen.js), respaldo_bd.py
.github/workflows/   build-apk.yml, pwa-pages.yml
```

## Estado de verificación
Probado en un navegador automatizado con Telegram simulado (48 pruebas: perfil, vinculación, guardia, servicio, checklist, FRAP→PDF→Telegram, bandeja sin internet). El PDF se revisó visualmente y el generador de QR se validó con un lector real.
**No** se pudo compilar el APK en el entorno donde se preparó (sin acceso a npm ni al SDK de Android): la primera ejecución del flujo en GitHub puede necesitar un ajuste; si falla, copia el registro del paso con error.
