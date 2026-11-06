// offline-sync.js
// Motor genérico de guardado/sincronización offline. Soporta varios tipos
// de registro (FRAP, salida de servicio, cierre de servicio) en la misma
// cola de IndexedDB.
//
// Regla de oro: SIEMPRE se guarda localmente primero. Solo se borra el
// registro pendiente cuando el servidor confirma que lo recibió.

const DB_NAME = 'frap_offline_db';
const STORE_NAME = 'pendientes';

function abrirDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

// tipo: 'frap' | 'salida_servicio' | 'cierre_servicio'
async function guardarPendiente(datos, tipo = 'frap') {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).add({ tipo, datos, fecha: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function listarPendientes() {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result.map(item => ({ ...item, tipo: item.tipo || 'frap' })));
        req.onerror = (e) => reject(e.target.error);
    });
}

async function contarPendientes() {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function eliminarPendiente(id) {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

function objetoAFormData(datosFrap) {
    const formData = new FormData();
    for (let key in datosFrap) {
        if (Array.isArray(datosFrap[key])) {
            datosFrap[key].forEach(val => formData.append(key, val));
        } else {
            formData.append(key, datosFrap[key]);
        }
    }
    return formData;
}

// Envía un registro pendiente al endpoint que le corresponda según su tipo.
// Devuelve { ok, json } — json trae la respuesta del servidor cuando aplica
// (por ejemplo, el folio/ID real que asignó al crear una salida de servicio).
async function enviarAlServidor(item, timeoutMs = null) {
    // Los checklists pueden traer fotos y video (varios MB) — necesitan
    // mucho más tiempo que un envío normal antes de darlos por fallidos.
    if (timeoutMs === null) {
        timeoutMs = (item.tipo === 'checklist') ? 120000 : 12000;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
    try {
        let resp;
        if (item.tipo === 'salida_servicio') {
            resp = await fetch(base + '/api/servicio.php', {
                method: 'POST', credentials: 'include', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'salida', ...item.datos })
            });
        } else if (item.tipo === 'cierre_servicio') {
            resp = await fetch(base + '/api/servicio.php', {
                method: 'POST', credentials: 'include', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cierre', ...item.datos })
            });
        } else if (item.tipo === 'checklist') {
            resp = await fetch(base + '/api/checklist.php', {
                method: 'POST', credentials: 'include', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item.datos)
            });
        } else {
            // FRAP (formato clásico, FormData a procesar.php)
            resp = await fetch(base + '/procesar.php', {
                method: 'POST', credentials: 'include', signal: controller.signal,
                body: objetoAFormData(item.datos)
            });
        }
        clearTimeout(timer);
        let json = null;
        try { json = await resp.clone().json(); } catch (e) { /* procesar.php puede no devolver JSON */ }
        return { ok: resp.ok, json };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, json: null };
    }
}

// Compatibilidad con código existente que llama intentarEnviar(datosFrap)
async function intentarEnviar(datosFrap, timeoutMs = 12000) {
    const resultado = await enviarAlServidor({ tipo: 'frap', datos: datosFrap }, timeoutMs);
    return resultado.ok;
}

// Consulta al servidor el folio real disponible en este momento. Se usa
// justo antes de enviar una FRAP que se creó offline con un folio temporal.
async function obtenerFolioReal() {
    try {
        const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
        const resp = await fetch(base + '/api/folio.php', { credentials: 'include' });
        if (!resp.ok) return null;
        const datos = await resp.json();
        return datos.success ? datos.folio : null;
    } catch (err) {
        return null;
    }
}

// Sincroniza uno por uno (secuencial, no en paralelo) para evitar condiciones
// de carrera al borrar registros, pedir folios, y enlazar cierres de
// servicio con su salida correspondiente.
let sincronizando = false;
async function sincronizarPendientes() {
    if (sincronizando) return;
    sincronizando = true;
    try {
        const pendientes = await listarPendientes();
        if (pendientes.length === 0) return;

        mostrarEstadoSync(`📡 Enviando ${pendientes.length} registro(s) guardado(s)...`);

        let enviados = 0;
        for (const item of pendientes) {

            // FRAP con folio temporal: pedir el folio real antes de mandarla.
            if (item.tipo === 'frap' && typeof item.datos.folio === 'string' && item.datos.folio.startsWith('PENDIENTE-')) {
                const folioReal = await obtenerFolioReal();
                if (!folioReal) break; // seguimos sin conexión real, reintentar después
                item.datos.folio = folioReal;
            }

            // Cierre de servicio que todavía no sabe el ID real de su salida
            // (la salida se creó offline y aún no ha sincronizado): buscamos
            // si ya se resolvió el mapeo; si no, lo saltamos por ahora sin
            // detener el resto de la cola.
            if (item.tipo === 'cierre_servicio' && !item.datos.servicio_id && item.datos.local_servicio_ref) {
                const mapa = JSON.parse(localStorage.getItem('servicio_id_map') || '{}');
                const real = mapa[item.datos.local_servicio_ref];
                if (real) {
                    item.datos.servicio_id = real.id;
                } else {
                    continue; // aún no hay salida sincronizada que enlazar; se reintenta luego
                }
            }

            const resultado = await enviarAlServidor(item);
            if (resultado.ok) {
                if (item.tipo === 'salida_servicio' && resultado.json && resultado.json.servicio && item.datos.local_servicio_ref) {
                    const mapa = JSON.parse(localStorage.getItem('servicio_id_map') || '{}');
                    mapa[item.datos.local_servicio_ref] = resultado.json.servicio;
                    localStorage.setItem('servicio_id_map', JSON.stringify(mapa));

                    const activo = JSON.parse(localStorage.getItem('servicio_activo') || 'null');
                    if (activo && activo.local_servicio_ref === item.datos.local_servicio_ref) {
                        activo.sincronizado = true;
                        activo.id = resultado.json.servicio.id;
                        activo.folio_servicio = resultado.json.servicio.folio_servicio;
                        localStorage.setItem('servicio_activo', JSON.stringify(activo));
                    }
                }
                if (item.tipo === 'cierre_servicio') {
                    localStorage.removeItem('servicio_activo');
                }
                await eliminarPendiente(item.id);
                enviados++;
            } else {
                break; // probablemente se cayó la red de nuevo
            }
        }

        if (enviados > 0) {
            mostrarEstadoSync(`✅ ${enviados} registro(s) enviado(s) con éxito.`);
        }
        const restantes = await contarPendientes();
        if (restantes > 0) {
            mostrarEstadoSync(`⚠️ Quedan ${restantes} registro(s) por enviar (sin señal aún).`);
        }
    } finally {
        sincronizando = false;
    }
}

function mostrarEstadoSync(mensaje) {
    console.log('[sync]', mensaje);
    let banner = document.getElementById('frap-sync-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'frap-sync-banner';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#333;color:#fff;padding:8px;text-align:center;font-size:14px;z-index:9999;';
        document.body.appendChild(banner);
    }
    banner.textContent = mensaje;
    banner.style.display = 'block';
    clearTimeout(banner._timeout);
    banner._timeout = setTimeout(() => { banner.style.display = 'none'; }, 5000);
}

// --- Detección de conexión real (no solo navigator.onLine) ---
function pluginRed() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Network)
        ? window.Capacitor.Plugins.Network
        : null;
}

async function hayConexionReal() {
    const network = pluginRed();
    if (network) {
        const estado = await network.getStatus();
        return estado.connected;
    }
    return navigator.onLine;
}

function iniciarListenersDeRed() {
    const network = pluginRed();
    if (network) {
        network.addListener('networkStatusChange', (estado) => {
            if (estado.connected) sincronizarPendientes();
        });
    } else {
        window.addEventListener('online', sincronizarPendientes);
    }
    setInterval(sincronizarPendientes, 60000);
    sincronizarPendientes();
}
