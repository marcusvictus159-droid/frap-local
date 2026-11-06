// app-config.js
// ---------------------------------------------------------------------------
// Configuración común de todas las pantallas.
//
// API_BASE ya NO es un servidor real: es una dirección "de mentira" que
// local-core.js intercepta y responde dentro del teléfono (ver local-core.js).
// ---------------------------------------------------------------------------
const API_BASE = 'https://frap.local';

// --- Márgenes de la barra de estado y del teclado --------------------------
// MainActivity.java (Android) calcula la altura real de la barra de estado, de
// la barra de navegación y del teclado, y los deja en variables CSS:
//   --status-bar-height   --nav-bar-height   --keyboard-height
// Fuera de Android (PWA en iPhone / navegador) usamos las "safe areas" del sistema.
window.__setInsets = function (arriba, abajo, teclado) {
    const r = document.documentElement.style;
    r.setProperty('--status-bar-height', arriba + 'px');
    r.setProperty('--nav-bar-height', abajo + 'px');
    r.setProperty('--keyboard-height', teclado + 'px');
};
(function () {
    try {
        if (window.AndroidInsets) {
            window.__setInsets(window.AndroidInsets.top(), window.AndroidInsets.bottom(), window.AndroidInsets.keyboard());
        } else if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
            const r = document.documentElement.style;
            r.setProperty('--status-bar-height', 'env(safe-area-inset-top, 0px)');
            r.setProperty('--keyboard-height', 'env(safe-area-inset-bottom, 0px)');
        }
    } catch (e) { /* sin ajuste: se usan los valores por defecto del CSS */ }
})();

// --- Evitar que el teclado tape el campo que estás llenando ---
// Este script se carga en <head>, ANTES de que exista <body>; por eso
// esperamos a DOMContentLoaded antes de tocar document.body.
function iniciarAjusteTeclado() {
    document.body.style.transition = 'padding-bottom 0.2s ease';
    document.body.style.paddingBottom = 'var(--keyboard-height, 0px)';

    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el.matches && el.matches('input, textarea, select')) {
            setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 350);
        }
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarAjusteTeclado);
} else {
    iniciarAjusteTeclado();
}

// --- Botón / gesto "atrás" de Android --------------------------------------
// Sin esto, "atrás" cierra la app. Aquí: cierra el modal abierto; en las
// pantallas principales sale de la app; en las demás regresa a la anterior.
(function () {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener('backButton', function () {
        const modal = document.querySelector('.modal.show');
        if (modal && window.bootstrap) {
            const m = window.bootstrap.Modal.getInstance(modal);
            if (m) { m.hide(); return; }
        }
        const ruta = location.pathname;
        if (/\/(dashboard|checklist|login|index)\.html$/.test(ruta) || /\/$/.test(ruta)) { App.exitApp(); return; }
        if (history.length > 1) history.back(); else location.href = 'index.html';
    });
})();

// --- Service Worker: solo para la versión web/PWA (iPhone). En la app de
// Android todo va empaquetado en el APK y no hace falta. ---
if ('serviceWorker' in navigator && !window.Capacitor) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('Error SW:', err));
    });
}

// Pide al navegador que NO borre los datos guardados (FRAP, guardias, checklists, servicios).
// Importante sobre todo en iPhone y Safari, que pueden limpiar el almacenamiento si no se usa la app.
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* sin soporte */ }
