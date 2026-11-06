// gps-ubicacion.js — botón "Detectar mi ubicación": lee el GPS del teléfono y muestra
// coordenadas, precisión, hora y mapa, con botones para compartir, copiar y abrir el mapa.
// Funciona sin internet (las coordenadas siempre salen); el mapa y la dirección en texto
// necesitan datos o wifi.
//
// Uso:
//   GPSUbic.montar(document.getElementById('gps'), { titulo: 'Coordenadas del servicio', onDatos(d) { ... } });
//   d = { lat, lng, precision, altitud, hora, direccion: { linea, municipio } | null }
(function () {
    'use strict';

    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function dms(valor, positivo, negativo) {
        const hem = valor >= 0 ? positivo : negativo;
        const a = Math.abs(valor);
        const g = Math.floor(a);
        const mFull = (a - g) * 60;
        const m = Math.floor(mFull);
        const s = ((mFull - m) * 60).toFixed(1);
        return g + '°' + String(m).padStart(2, '0') + "'" + String(s).padStart(4, '0') + '"' + hem;
    }

    function enlaceMapa(lat, lng) { return 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6); }

    function textoFicha(d) {
        return '📍 Ubicación del servicio\n' +
            'Lat: ' + d.lat.toFixed(6) + '  Lng: ' + d.lng.toFixed(6) + '\n' +
            (d.precision ? 'Precisión: ±' + Math.round(d.precision) + ' m\n' : '') +
            (d.direccion && d.direccion.linea ? d.direccion.linea + (d.direccion.municipio ? ', ' + d.direccion.municipio : '') + '\n' : '') +
            enlaceMapa(d.lat, d.lng);
    }

    function pedirPosicion() {
        const cap = window.Capacitor;
        const nativo = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
        const Geo = nativo && cap.Plugins && cap.Plugins.Geolocation;
        if (Geo) {
            return Promise.resolve()
                .then(() => Geo.requestPermissions ? Geo.requestPermissions().catch(() => null) : null)
                .then(() => Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
        }
        return new Promise((ok, mal) => {
            if (!navigator.geolocation) { mal({ code: 99 }); return; }
            navigator.geolocation.getCurrentPosition(ok, mal, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        });
    }

    function mensajeError(e) {
        const c = e && e.code;
        const t = String((e && e.message) || '').toLowerCase();
        if (c === 1 || t.indexOf('denied') >= 0 || t.indexOf('permission') >= 0)
            return 'No hay permiso de ubicación. Actívalo en los ajustes del teléfono para esta app y toca Reintentar.';
        if (c === 99) return 'Este dispositivo no permite leer el GPS.';
        if (c === 3 || t.indexOf('timeout') >= 0) return 'El GPS tardó demasiado. Sal a un lugar abierto y toca Reintentar.';
        if (t.indexOf('disabled') >= 0 || t.indexOf('location services') >= 0) return 'El GPS está apagado. Enciéndelo y toca Reintentar.';
        return 'No se pudo obtener la ubicación. Revisa que el GPS esté encendido y toca Reintentar.';
    }

    async function direccionTexto(lat, lng) {
        try {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 7000);
            const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=es&lat=' + lat + '&lon=' + lng, { signal: ctrl.signal });
            clearTimeout(tm);
            if (!r.ok) return null;
            const j = await r.json();
            const a = j.address || {};
            const calle = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
            const col = a.suburb || a.neighbourhood || a.quarter || a.village || '';
            const linea = [calle, col].filter(Boolean).join(', ') || (j.display_name || '').split(',').slice(0, 2).join(',').trim();
            const municipio = a.city || a.town || a.municipality || a.county || a.village || '';
            return linea || municipio ? { linea, municipio } : null;
        } catch (e) { return null; }
    }

    function montar(cont, opts) {
        opts = opts || {};
        const titulo = opts.titulo || 'Coordenadas del servicio';
        let datos = null, mapa = null, marca = null, circulo = null, ocupado = false;

        cont.classList.add('gps-caja');
        cont.innerHTML =
            '<div class="gps-vacio">' +
                '<button type="button" class="gps-detectar"><i class="bi bi-crosshair2"></i><span>Detectar mi ubicación</span></button>' +
                '<div class="gps-ayuda">Usa el GPS del teléfono para marcar dónde estás. Sin internet también guarda las coordenadas.</div>' +
            '</div>' +
            '<div class="gps-estado" hidden></div>' +
            '<div class="gps-card" hidden>' +
                '<div class="gps-cab"><span class="gps-ico"><i class="bi bi-broadcast-pin"></i></span><b class="gps-tit">' + esc(titulo) + '</b><span class="gps-prec"></span></div>' +
                '<div class="gps-coords">' +
                    '<div class="gps-c"><small>Latitud</small><strong class="gps-lat"></strong><em class="gps-lat-dms"></em></div>' +
                    '<div class="gps-c"><small>Longitud</small><strong class="gps-lng"></strong><em class="gps-lng-dms"></em></div>' +
                '</div>' +
                '<div class="gps-meta"><i class="bi bi-clock-fill"></i> <span class="gps-hora"></span></div>' +
                '<div class="gps-dir" hidden></div>' +
                '<button type="button" class="gps-compartir"><i class="bi bi-share-fill"></i> Compartir ficha de ubicación</button>' +
                '<div class="gps-acciones">' +
                    '<button type="button" class="gps-copiar"><i class="bi bi-copy"></i> Copiar</button>' +
                    '<button type="button" class="gps-abrir"><i class="bi bi-map-fill"></i> Abrir mapa</button>' +
                    '<button type="button" class="gps-actualizar"><i class="bi bi-arrow-repeat"></i> Actualizar</button>' +
                '</div>' +
                '<div class="gps-mapa-marco"><div class="gps-mapa"></div><div class="gps-sinmapa" hidden>Mapa no disponible sin internet. Las coordenadas quedan guardadas.</div></div>' +
            '</div>';

        const q = (s) => cont.querySelector(s);
        const vacio = q('.gps-vacio'), estado = q('.gps-estado'), card = q('.gps-card');

        function mostrarEstado(html, tipo) {
            estado.className = 'gps-estado ' + (tipo || '');
            estado.innerHTML = html;
            estado.hidden = false;
        }

        function aviso(t) {
            const el = q('.gps-meta');
            const prev = el.innerHTML;
            el.innerHTML = '<i class="bi bi-check-circle-fill"></i> ' + esc(t);
            setTimeout(() => { el.innerHTML = prev; }, 1800);
        }

        function pintarMapa() {
            const caja = q('.gps-mapa');
            if (!window.L) { q('.gps-sinmapa').hidden = false; caja.style.display = 'none'; return; }
            const ll = [datos.lat, datos.lng];
            if (!mapa) {
                mapa = L.map(caja, { zoomControl: true, attributionControl: true }).setView(ll, 17);
                const capa = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
                let fallos = 0;
                capa.on('tileerror', () => { if (++fallos > 3) q('.gps-sinmapa').hidden = false; });
                capa.on('tileload', () => { q('.gps-sinmapa').hidden = true; });
                marca = L.marker(ll, { icon: L.divIcon({ className: 'gps-pin', html: '<i class="bi bi-geo-alt-fill"></i>', iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(mapa);
                circulo = L.circle(ll, { radius: Math.max(datos.precision || 10, 5), color: '#ff3b4d', weight: 1, fillColor: '#ff3b4d', fillOpacity: 0.12 }).addTo(mapa);
            } else {
                marca.setLatLng(ll); circulo.setLatLng(ll); circulo.setRadius(Math.max(datos.precision || 10, 5));
                mapa.setView(ll, 17);
            }
            setTimeout(() => mapa.invalidateSize(), 80);
        }

        function pintar() {
            vacio.hidden = true; estado.hidden = true; card.hidden = false;
            q('.gps-lat').textContent = datos.lat.toFixed(6);
            q('.gps-lng').textContent = datos.lng.toFixed(6);
            q('.gps-lat-dms').textContent = dms(datos.lat, 'N', 'S');
            q('.gps-lng-dms').textContent = dms(datos.lng, 'E', 'O');
            const pr = q('.gps-prec');
            if (datos.precision) {
                const m = Math.round(datos.precision);
                pr.textContent = '±' + m + ' m';
                pr.className = 'gps-prec ' + (m <= 15 ? 'buena' : m <= 50 ? 'media' : 'baja');
            } else { pr.textContent = ''; }
            const h = datos.hora;
            q('.gps-hora').textContent = 'Tomada a las ' + h.toLocaleTimeString('es-MX', { hour12: false }) +
                (datos.altitud != null && isFinite(datos.altitud) ? ' · altitud ' + Math.round(datos.altitud) + ' m' : '');
            const dir = q('.gps-dir');
            if (datos.direccion && datos.direccion.linea) {
                dir.textContent = datos.direccion.linea + (datos.direccion.municipio ? ', ' + datos.direccion.municipio : '');
                dir.hidden = false;
            } else { dir.hidden = true; }
            pintarMapa();
        }

        async function detectar() {
            if (ocupado) return;
            ocupado = true;
            vacio.hidden = true;
            if (!datos) card.hidden = true;
            mostrarEstado('<span class="gps-spin"></span> Buscando señal GPS…', 'buscando');
            try {
                const pos = await pedirPosicion();
                const c = pos.coords;
                datos = { lat: c.latitude, lng: c.longitude, precision: c.accuracy, altitud: c.altitude, hora: new Date(pos.timestamp || Date.now()), direccion: null };
                pintar();
                if (opts.onDatos) opts.onDatos(datos);
                direccionTexto(datos.lat, datos.lng).then((dir) => {
                    if (!dir || !datos) return;
                    datos.direccion = dir; pintar();
                    if (opts.onDatos) opts.onDatos(datos);
                });
            } catch (e) {
                if (datos) { pintar(); aviso('No se pudo actualizar'); }
                else {
                    mostrarEstado('<i class="bi bi-exclamation-triangle-fill"></i> ' + esc(mensajeError(e)) + '<button type="button" class="gps-reintentar">Reintentar</button>', 'error');
                    estado.querySelector('.gps-reintentar').addEventListener('click', detectar);
                }
            } finally { ocupado = false; }
        }

        async function copiar() {
            const t = datos.lat.toFixed(6) + ', ' + datos.lng.toFixed(6);
            try { await navigator.clipboard.writeText(t); }
            catch (e) {
                const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
            }
            aviso('Coordenadas copiadas');
        }

        async function compartir() {
            const texto = textoFicha(datos);
            const cap = window.Capacitor;
            try {
                if (cap && cap.Plugins && cap.Plugins.Share && cap.isNativePlatform && cap.isNativePlatform()) {
                    await cap.Plugins.Share.share({ title: 'Ubicación del servicio', text: texto, dialogTitle: 'Compartir ubicación' });
                } else if (navigator.share) {
                    await navigator.share({ title: 'Ubicación del servicio', text: texto });
                } else {
                    await navigator.clipboard.writeText(texto); aviso('Ficha copiada');
                }
            } catch (e) { /* cancelado por el usuario */ }
        }

        q('.gps-detectar').addEventListener('click', detectar);
        q('.gps-actualizar').addEventListener('click', detectar);
        q('.gps-copiar').addEventListener('click', copiar);
        q('.gps-compartir').addEventListener('click', compartir);
        q('.gps-abrir').addEventListener('click', () => { window.open(enlaceMapa(datos.lat, datos.lng), '_blank'); });

        return { detectar, datos: () => datos };
    }

    window.GPSUbic = { montar, enlaceMapa, dms, textoFicha };
})();
