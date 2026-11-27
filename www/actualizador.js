// actualizador.js — aviso de "nueva actualización" (solo app Android).
// Al abrir el panel, la app consulta un archivo version.json en tu hosting.
// Si el número de versión publicado es mayor que el instalado, muestra un aviso
// con el botón de descarga. Sin internet no hace nada.
(function () {
    const URL_VERSION = (function () { try { return localStorage.getItem('update_url'); } catch (e) { return null; } })()
        || 'https://services80.xyz/steap/version.json';
    const instalada = Number(window.APP_BUILD || 0);
    const nativa = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!instalada || (!nativa && !window.__FORZAR_ACTUALIZADOR)) return;

    function mostrar(info) {
        if (document.getElementById('avisoActualizacion')) return;
        const f = document.createElement('div');
        f.id = 'avisoActualizacion';
        f.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,12,24,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
        const c = document.createElement('div');
        c.setAttribute('role', 'dialog'); c.setAttribute('aria-modal', 'true');
        c.style.cssText = 'max-width:380px;width:100%;background:#0f1b2e;color:#fff;border:1px solid #1a6fb5;border-radius:18px;padding:22px 20px;box-shadow:0 10px 40px rgba(0,0,0,.5);text-align:center;font-family:inherit;';
        const h = document.createElement('h5'); h.textContent = '¡Hola! Tienes una nueva actualización'; h.style.cssText = 'font-weight:700;margin:0 0 8px;text-transform:none;letter-spacing:0;font-size:1.2rem;color:#fff;';
        const p = document.createElement('p'); p.textContent = 'Da clic en el botón de descarga para estar al día.'; p.style.cssText = 'margin:0 0 10px;opacity:.9;';
        c.appendChild(h); c.appendChild(p);
        if (info.versionName || info.notas) {
            const n = document.createElement('p');
            n.textContent = (info.versionName ? 'Versión ' + info.versionName : '') + (info.notas ? (info.versionName ? ' — ' : '') + info.notas : '');
            n.style.cssText = 'font-size:.85rem;opacity:.7;margin:0 0 14px;';
            c.appendChild(n);
        }
        const a = document.createElement('a');
        a.href = info.apk; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Descargar actualización';
        a.style.cssText = 'display:block;background:#f2dc00;color:#0b1d33;font-weight:800;text-decoration:none;border-radius:12px;padding:12px;margin-bottom:8px;';
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = 'Más tarde';
        b.style.cssText = 'background:none;border:0;color:#9fb3cc;padding:8px;';
        b.onclick = function () { try { sessionStorage.setItem('actualizacion_pospuesta', String(info.versionCode)); } catch (e) {} f.remove(); };
        c.appendChild(a); c.appendChild(b); f.appendChild(c); document.body.appendChild(f);
    }

    async function revisar() {
        try {
            const r = await fetch(URL_VERSION + (URL_VERSION.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) return;
            const info = await r.json();
            if (!info || !info.apk || Number(info.versionCode) <= instalada) return;
            if (!/^https:\/\//i.test(info.apk)) return;
            try { if (sessionStorage.getItem('actualizacion_pospuesta') === String(info.versionCode)) return; } catch (e) {}
            mostrar(info);
        } catch (e) { /* sin internet: se intentará la próxima vez */ }
    }
    window.revisarActualizacion = revisar;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisar); else revisar();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revisar(); });
})();
