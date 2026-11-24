// rastreo.js — comparte la ubicación de la unidad en tiempo real mientras hay un servicio activo.
//
//  · Al salir a servicio: genera un enlace de seguimiento, lo manda por Telegram y empieza a enviar el GPS al servidor (hosting).
//  · Android (APK): usa un servicio en primer plano (plugin BackgroundGeolocation) para seguir enviando con la pantalla apagada.
//  · iPhone / navegador: solo envía mientras la app está abierta y la pantalla encendida (límite de iOS).
//  · Sin internet: guarda la ruta en el teléfono y la envía completa al regresar la señal.
//  · Al cerrar el servicio: envía lo pendiente, avisa "fin" y apaga el GPS.
(function () {
    'use strict';
    var K_CFG = 'rastreo_config', K_ACT = 'rastreo_activo', K_BUF = 'rastreo_buf', K_FIN = 'rastreo_fin';
    var MAX_BUF = 600, MAX_HORAS = 24;
    var watcherId = null, watchId = null, enviando = false, ultimoPush = null, ultimoFlush = 0, estado = 'inactivo', ultimaPos = null, enviados = 0;

    function leer(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } }
    function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno */ } }
    function borrar(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function cfg() { return leer(K_CFG, null); }
    function guardarCfg(c) {
        var url = String(c.url || '').trim().replace(/\/+$/, '');
        if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
        url = url.replace(/\/(api\.php|panel\.html|ver\.html|index\.html)$/i, '');
        guardar(K_CFG, { url: url, clave: String(c.clave || '').trim(), activo: c.activo !== false });
    }
    function configurado() { var c = cfg(); return !!(c && c.url && c.clave && c.activo !== false); }
    function enlace(token) { return cfg().url + '/ver.html?t=' + token; }
    function nuevoToken() {
        var a = new Uint8Array(12);
        (window.crypto || window.msCrypto).getRandomValues(a);
        return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    }

    function api(accion, cuerpo, ms) {
        var c = cfg();
        if (!c || !c.url) return Promise.reject(new Error('Rastreo sin configurar'));
        var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, ms || 15000);
        cuerpo = Object.assign({ accion: accion, clave: c.clave }, cuerpo || {});
        return fetch(c.url + '/api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: ctrl.signal })
            .then(function (r) { return r.json().catch(function () { throw new Error('El servidor no respondió como se esperaba (¿la dirección es correcta?).'); }); })
            .then(function (d) { clearTimeout(t); if (!d.ok) { var e = new Error(d.error || 'Error del servidor'); e.servidor = true; throw e; } return d; })
            .catch(function (e) { clearTimeout(t); throw e; });
    }
    function probar() { return api('ping', {}, 12000); }

    // --------------------------------------------------------------- servicio
    function preparar() { if (!configurado()) return null; var t = nuevoToken(); return { token: t, link: enlace(t) }; }

    function arrancar(token, info) {
        guardar(K_ACT, { token: token, info: info || {}, inicioOk: false, desde: Date.now() });
        borrar(K_BUF); enviados = 0;
        enviarInicio(); iniciarGps(); pintar();
    }
    function enviarInicio() {
        var a = leer(K_ACT, null);
        if (!a || a.inicioOk) return Promise.resolve();
        return api('inicio', { token: a.token, folio: a.info.folio, unidad: a.info.unidad, tipo: a.info.tipo }).then(function () {
            var b = leer(K_ACT, null); if (b && b.token === a.token) { b.inicioOk = true; guardar(K_ACT, b); }
        }).catch(function () {});
    }
    function detener(token) {
        var a = leer(K_ACT, null);
        if (!a || (token && a.token !== token)) return Promise.resolve();
        apagarGps();
        var fin = leer(K_FIN, []); if (fin.indexOf(a.token) < 0) fin.push(a.token); guardar(K_FIN, fin);
        var tk = a.token;
        return enviarInicio().then(function () { return vaciar(true); }).then(function () { return reintentarFin(); }).then(function () {
            var b = leer(K_ACT, null); if (b && b.token === tk) { borrar(K_ACT); borrar(K_BUF); }
            estado = 'inactivo'; pintar();
        }).catch(function () { var b = leer(K_ACT, null); if (b && b.token === tk) { borrar(K_ACT); } estado = 'inactivo'; pintar(); });
    }
    function reintentarFin() {
        var lista = leer(K_FIN, []); if (!lista.length) return Promise.resolve();
        return lista.reduce(function (p, t) {
            return p.then(function () { return api('fin', { token: t }).then(function () { var r = leer(K_FIN, []).filter(function (x) { return x !== t; }); guardar(K_FIN, r); }).catch(function (e) { if (e.servidor) { guardar(K_FIN, leer(K_FIN, []).filter(function (x) { return x !== t; })); } }); });
        }, Promise.resolve());
    }

    // -------------------------------------------------------------------- gps
    function distancia(a, b) {
        var R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
        var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function alRecibir(p) {
        if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return;
        ultimaPos = p; if (estado === 'sin_permiso' || estado === 'buscando' || estado === 'inactivo') estado = 'enviando';
        var ahora = Date.now();
        if (ultimoPush) {
            var dt = ahora - ultimoPush.t, mov = distancia(ultimoPush, p);
            if (dt < 4000 || (dt < 20000 && mov < 8)) { pintar(); return; }
        }
        ultimoPush = { t: ahora, lat: p.lat, lng: p.lng };
        var buf = leer(K_BUF, []);
        buf.push({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), acc: p.acc != null ? Math.round(p.acc) : null, vel: p.vel != null && p.vel >= 0 ? +p.vel.toFixed(1) : null, rumbo: p.rumbo != null && p.rumbo >= 0 ? Math.round(p.rumbo) : null, ts: p.ts || ahora });
        if (buf.length > MAX_BUF) buf = buf.slice(buf.length - MAX_BUF);
        guardar(K_BUF, buf);
        if (ahora - ultimoFlush > 4500) vaciar();
        pintar();
    }
    function vaciar(todo) {
        var a = leer(K_ACT, null); if (!a) return Promise.resolve();
        var buf = leer(K_BUF, []); if (!buf.length) { return a.inicioOk ? Promise.resolve() : enviarInicio(); }
        if (enviando) return Promise.resolve();
        enviando = true; ultimoFlush = Date.now();
        var lote = buf.slice(0, 120), n = lote.length;
        return (a.inicioOk ? Promise.resolve() : enviarInicio()).then(function () {
            return api('pos', { token: a.token, puntos: lote });
        }).then(function () {
            var rest = leer(K_BUF, []).slice(n); guardar(K_BUF, rest); enviados += n; estado = 'enviando'; enviando = false;
            if (rest.length && todo) return vaciar(true);
        }).catch(function (e) {
            enviando = false; estado = e && e.servidor ? 'error' : 'sin_red';
            if (e && e.servidor && /Servicio desconocido/.test(e.message)) { var b = leer(K_ACT, null); if (b) { b.inicioOk = false; guardar(K_ACT, b); } }
        }).then(pintar);
    }
    function nativo() { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); }
    function iniciarGps() {
        if (watcherId !== null || watchId !== null) return;
        estado = 'buscando';
        var BG = nativo() && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation;
        if (BG && BG.addWatcher) {
            watcherId = 'pendiente';
            BG.addWatcher({
                backgroundTitle: 'STEAP FRAP · Servicio en curso',
                backgroundMessage: 'Compartiendo la ubicación de la unidad',
                requestPermissions: true, stale: false, distanceFilter: 5
            }, function (loc, err) {
                if (err) { if (err.code === 'NOT_AUTHORIZED') { estado = 'sin_permiso'; pintar(); } return; }
                if (loc) alRecibir({ lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy, vel: loc.speed, rumbo: loc.bearing, ts: loc.time });
            }).then(function (id) { watcherId = id; }).catch(function () { watcherId = null; estado = 'sin_permiso'; pintar(); });
        } else if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(function (g) {
                var c = g.coords; alRecibir({ lat: c.latitude, lng: c.longitude, acc: c.accuracy, vel: c.speed, rumbo: c.heading, ts: g.timestamp });
            }, function (e) { if (e && e.code === 1) { estado = 'sin_permiso'; pintar(); } }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
        } else { estado = 'sin_permiso'; }
    }
    function apagarGps() {
        var BG = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation;
        if (watcherId && watcherId !== 'pendiente' && BG && BG.removeWatcher) { try { BG.removeWatcher({ id: watcherId }); } catch (e) {} }
        if (watchId !== null && navigator.geolocation) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} }
        watcherId = null; watchId = null; ultimoPush = null;
    }

    // ------------------------------------------------------------------ aviso en pantalla
    var pill = null;
    function pintar() {
        var a = leer(K_ACT, null);
        if (!a) { if (pill) pill.style.display = 'none'; return; }
        if (!pill) {
            pill = document.createElement('div'); pill.id = 'rastreoPill';
            pill.style.cssText = 'position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;font:700 12px/1.1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#0b1224;border:1px solid #2f7bc4;box-shadow:0 4px 14px rgba(0,0,0,.45);pointer-events:none';
            (document.body || document.documentElement).appendChild(pill);
        }
        var m = {
            buscando: ['#f5a623', 'Buscando GPS…'], enviando: ['#2ecc71', 'Rastreo en vivo'], sin_red: ['#f5a623', 'Sin internet · guardando ruta'],
            sin_permiso: ['#ef4444', 'Activa la ubicación'], error: ['#ef4444', 'Error del servidor de rastreo'], inactivo: ['#9aa5bd', 'Rastreo']
        }[estado] || ['#9aa5bd', 'Rastreo'];
        pill.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:' + m[0] + ';box-shadow:0 0 0 3px ' + m[0] + '33"></span>' + m[1];
        pill.style.display = 'flex';
    }

    // ------------------------------------------------------------------ arranque en cada página
    function reanudar() {
        var a = leer(K_ACT, null);
        if (a && (Date.now() - a.desde) > MAX_HORAS * 3600 * 1000) { detener(a.token); return; }
        if (a) { iniciarGps(); enviarInicio(); pintar(); }
        reintentarFin();
    }
    function init() {
        reanudar();
        setInterval(function () { if (leer(K_ACT, null)) { vaciar(); enviarInicio(); } reintentarFin(); }, 6000);
        window.addEventListener('online', function () { vaciar(true); reintentarFin(); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden && leer(K_ACT, null)) { iniciarGps(); vaciar(); } });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Rastreo = {
        cfg: cfg, guardarCfg: guardarCfg, configurado: configurado, probar: probar, preparar: preparar, arrancar: arrancar, detener: detener,
        activo: function () { return leer(K_ACT, null); }, enlace: enlace, estado: function () { return estado; }
    };
})();
