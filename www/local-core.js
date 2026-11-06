// local-core.js
// ---------------------------------------------------------------------------
// FRAP Digital CRM — núcleo LOCAL (sin servidor).
//
// Antes, la app le hablaba a softechmx.xyz (PHP + MySQL). Ahora todo vive en
// el teléfono:
//   · Perfil del usuario ........ localStorage
//   · Guardias, servicios, FRAP,
//     checklists, bandeja de envío IndexedDB ("frap_local")
//   · Aviso / PDF a Telegram .... directo desde el teléfono (api.telegram.org)
//
// Para no reescribir todas las pantallas, este archivo intercepta las llamadas
// fetch(API_BASE + '/api/...') que ya hacían las páginas y las responde aquí
// mismo, con las mismas respuestas JSON que daba el servidor.
//
// Regla de oro: SIEMPRE se guarda primero en el teléfono; después se intenta
// avisar a Telegram. Si no hay internet, el aviso queda en la "bandeja de
// salida" (outbox) y se reenvía solo cuando regrese la señal.
// ---------------------------------------------------------------------------
(function () {
    'use strict';

    const API = (typeof API_BASE !== 'undefined') ? API_BASE : 'https://frap.local';
    const META_HORAS_MES = 40;

    // ----------------------------------------------------------- utilidades
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const b = (s) => '<b>' + esc(s) + '</b>';

    function fechaLocalStr(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function parseLocal(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    }
    function horasMin(seg) {
        seg = Math.max(0, Math.floor(seg));
        return { h: Math.floor(seg / 3600), m: Math.floor((seg % 3600) / 60) };
    }
    function jsonResp(obj, status) {
        return new Response(JSON.stringify(obj), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
    function dataUrlABlob(dataUrl) {
        const coma = dataUrl.indexOf(',');
        const cab = dataUrl.slice(0, coma);
        const mime = (/data:([^;]+)/.exec(cab) || [])[1] || 'application/octet-stream';
        const bin = atob(dataUrl.slice(coma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    // --------------------------------------------------------------- perfil
    const STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);
    function iniciales(nombre) {
        const limpio = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
        const pal = limpio.split(/\s+/).filter(w => w && !STOP.has(w.toLowerCase()));
        const ini = pal.slice(0, 3).map(w => w[0].toUpperCase()).join('');
        return (ini.replace(/[^A-Z]/g, '') || 'USR');
    }
    function sufijoAzar() {
        const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 2; i++) s += abc[Math.floor(Math.random() * abc.length)];
        return s;
    }
    const Perfil = {
        get() {
            try { return JSON.parse(localStorage.getItem('perfil') || 'null'); } catch (e) { return null; }
        },
        // Crea o actualiza el perfil. La "clave" (p. ej. OCV-A7) identifica este
        // teléfono en los folios y NO cambia aunque edites tu nombre.
        guardar(nombre, rol) {
            const previo = this.get();
            const perfil = {
                nombre: String(nombre).trim().replace(/\s+/g, ' '),
                rol: rol === 'operador' ? 'operador' : 'paramedico',
                clave: previo && previo.clave ? previo.clave : iniciales(nombre) + '-' + sufijoAzar(),
                creado: previo && previo.creado ? previo.creado : fechaLocalStr()
            };
            localStorage.setItem('perfil', JSON.stringify(perfil));
            return perfil;
        },
        hayPerfil() { return !!this.get(); },
        sesionActiva() { return localStorage.getItem('sesion') === '1' && !!this.get(); },
        iniciarSesion() { localStorage.setItem('sesion', '1'); },
        cerrarSesion() {
            localStorage.removeItem('sesion');
            localStorage.removeItem('dashboard_cache');
            localStorage.removeItem('home_screen');
        },
        pantallaInicio() { const p = this.get(); return p && p.rol === 'operador' ? 'checklist.html' : 'dashboard.html'; }
    };

    // ------------------------------------------------------------ IndexedDB
    const DB = (() => {
        let abierta = null;
        function abrir() {
            if (abierta) return abierta;
            abierta = new Promise((resolve, reject) => {
                const req = indexedDB.open('frap_local', 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    ['guardias', 'servicios', 'checklists', 'outbox'].forEach(n => {
                        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id', autoIncrement: true });
                    });
                    if (!db.objectStoreNames.contains('fraps')) db.createObjectStore('fraps', { keyPath: 'folio' });
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = (e) => { abierta = null; reject(e.target.error); };
            });
            return abierta;
        }
        const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        async function st(n, modo) { const db = await abrir(); return db.transaction(n, modo || 'readonly').objectStore(n); }
        return {
            add: async (n, o) => p((await st(n, 'readwrite')).add(o)),
            put: async (n, o) => p((await st(n, 'readwrite')).put(o)),
            get: async (n, k) => p((await st(n)).get(k)),
            all: async (n) => p((await st(n)).getAll()),
            del: async (n, k) => p((await st(n, 'readwrite')).delete(k)),
            count: async (n) => p((await st(n)).count())
        };
    })();

    // ------------------------------------------------------------- Telegram
    // La vinculación (token del bot + id del grupo) se guarda en el teléfono.
    // Se captura UNA vez escaneando un QR o pegando un código (ver ajustes.html).
    // Así el APK / la web pública NO llevan ningún secreto adentro.
    class TgError extends Error {
        constructor(msg, o) { super(msg); o = o || {}; this.red = !!o.red; this.codigo = o.codigo || 0; }
    }
    const TG = {
        cfg() { try { return JSON.parse(localStorage.getItem('tg_config') || 'null'); } catch (e) { return null; } },
        configurado() { const c = this.cfg(); return !!(c && c.token && c.chat); },
        guardarCfg(c) { localStorage.setItem('tg_config', JSON.stringify(c)); },
        borrarCfg() { localStorage.removeItem('tg_config'); },

        // Código de vinculación: "FRAP1:" + base64(JSON {t: token, c: chat_id, g: nombre del grupo})
        decodificarCodigo(texto) {
            const limpio = String(texto || '').trim().replace(/\s+/g, '');
            if (!limpio.startsWith('FRAP1:')) throw new Error('El código debe empezar con FRAP1:');
            let obj;
            try { obj = JSON.parse(decodeURIComponent(escape(atob(limpio.slice(6))))); }
            catch (e) { throw new Error('El código está incompleto o dañado.'); }
            const token = String(obj.t || ''), chat = String(obj.c || '');
            if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('El token del bot no es válido.');
            if (!/^-?\d+$/.test(chat) && !/^@\w+$/.test(chat)) throw new Error('El id del grupo no es válido.');
            return { token, chat, grupo: obj.g ? String(obj.g) : '' };
        },
        codificarCodigo(token, chat, grupo) {
            const json = JSON.stringify({ t: token, c: chat, g: grupo || '' });
            return 'FRAP1:' + btoa(unescape(encodeURIComponent(json)));
        },

        async llamar(metodo, campos, timeoutMs) {
            const c = this.cfg();
            if (!c || !c.token) throw new TgError('Telegram todavía no está vinculado.', { codigo: -1 });
            const fd = new FormData();
            fd.append('chat_id', c.chat);
            for (const k in campos) { if (campos[k] !== undefined && campos[k] !== null) fd.append(k, campos[k]); }
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
            let resp;
            try {
                resp = await fetch('https://api.telegram.org/bot' + c.token + '/' + metodo, { method: 'POST', body: fd, signal: ctrl.signal });
            } catch (e) {
                throw new TgError('Sin conexión con Telegram.', { red: true });
            } finally { clearTimeout(timer); }
            let j = null;
            try { j = await resp.json(); } catch (e) { /* sin cuerpo JSON */ }
            if (resp.status === 429) throw new TgError('Telegram pide esperar un momento.', { red: true, codigo: 429 });
            if (resp.status >= 500) throw new TgError('Telegram no está disponible ahora.', { red: true, codigo: resp.status });
            if (!resp.ok || !j || !j.ok) throw new TgError((j && j.description) || ('Error ' + resp.status), { codigo: resp.status });
            return j.result;
        },
        mensaje(html) { return this.llamar('sendMessage', { text: html, parse_mode: 'HTML' }); },
        documento(blob, nombre, captionHtml) {
            return this.llamar('sendDocument', { document: new File([blob], nombre, { type: blob.type || 'application/pdf' }), caption: captionHtml, parse_mode: 'HTML' }, 120000);
        },
        foto(blob, caption) {
            return this.llamar('sendPhoto', { photo: new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }), caption }, 90000);
        },
        video(blob, caption) {
            return this.llamar('sendVideo', { video: new File([blob], 'video.mp4', { type: blob.type || 'video/mp4' }), caption, supports_streaming: 'true' }, 300000);
        },
        // Comprueba token y grupo (sin mandar nada al grupo).
        async verificar(cfg) {
            const antes = this.cfg();
            this.guardarCfg(cfg);
            try {
                const me = await fetch('https://api.telegram.org/bot' + cfg.token + '/getMe').then(r => r.json());
                if (!me.ok) throw new TgError('El token del bot no es válido.', { codigo: 401 });
                const chat = await this.llamar('getChat', {}, 15000);
                return { bot: me.result.username, grupo: chat.title || chat.username || chat.first_name || cfg.chat };
            } catch (e) {
                if (antes) this.guardarCfg(antes); else this.borrarCfg();
                if (e instanceof TgError) throw e;
                throw new TgError('Sin conexión con Telegram.', { red: true });
            }
        }
    };

    // ---------------------------------------------------- bandeja de salida
    // Cada aviso a Telegram se guarda aquí antes de enviarse.
    const Outbox = (() => {
        let enviando = false;
        let ultimoError = null;
        async function enviarItem(it) {
            if (it.tipo === 'msg') await TG.mensaje(it.html);
            else if (it.tipo === 'doc') await TG.documento(it.blob, it.nombre, it.caption);
            else if (it.tipo === 'foto') await TG.foto(it.blob, it.caption);
            else if (it.tipo === 'video') await TG.video(it.blob, it.caption);
            if (it.frap) {
                const f = await DB.get('fraps', it.frap);
                if (f) { f.enviado = true; f.enviado_en = fechaLocalStr(); await DB.put('fraps', f); }
            }
        }
        return {
            async agregar(item) { item.creado = Date.now(); item.fallos = 0; return DB.add('outbox', item); },
            contar() { return DB.count('outbox'); },
            ultimoError() { return ultimoError; },
            async listar() { return (await DB.all('outbox')).sort((x, y) => x.id - y.id); },
            // Intenta mandar todo lo pendiente, en orden. Devuelve cuántos salieron.
            async enviarPendientes(forzar) {
                if (enviando) return { enviados: 0, ocupado: true };
                enviando = true;
                let enviados = 0;
                try {
                    if (!TG.configurado()) { ultimoError = 'Telegram no está vinculado.'; return { enviados: 0, sinConfig: true }; }
                    const items = await this.listar();
                    for (const it of items) {
                        if ((it.fallos || 0) >= 5 && !forzar) continue;
                        try {
                            await enviarItem(it);
                            await DB.del('outbox', it.id);
                            enviados++;
                            ultimoError = null;
                        } catch (e) {
                            ultimoError = e.message;
                            if (e.red) break;                    // sin señal: reintentar después
                            it.fallos = (it.fallos || 0) + 1;    // error "de verdad": contarlo
                            it.ultimoError = e.message;
                            await DB.put('outbox', it);
                            if (e.codigo === 401 || e.codigo === 404 || e.codigo === -1) break; // token o grupo mal
                        }
                    }
                } finally { enviando = false; }
                return { enviados };
            }
        };
    })();

    // --------------------------------------------------------------- folios
    function siguienteFolio(prefijo, existentes) {
        const p = Perfil.get();
        const base = prefijo + '-' + new Date().getFullYear() + '-' + p.clave + '-';
        let max = 0;
        existentes.forEach(f => {
            if (f && String(f).startsWith(base)) { const n = parseInt(String(f).slice(base.length), 10); if (n > max) max = n; }
        });
        const guardado = parseInt(localStorage.getItem('cont_' + base) || '0', 10) || 0;
        return base + pad(Math.max(max, guardado) + 1, 4);
    }
    function reservarFolio(folio) {
        const m = /^(.*-)(\d{4})$/.exec(folio);
        if (m) localStorage.setItem('cont_' + m[1], String(parseInt(m[2], 10)));
    }

    // ------------------------------------------------------------- handlers
    function sinPerfil() { return jsonResp({ success: false, error: 'No hay sesión activa.' }, 401); }

    function avisoSinTelegram() {
        return TG.configurado() ? '' : '\n⚠️ Telegram aún no está vinculado; el aviso quedó pendiente.';
    }

    async function guardiaActiva(p) {
        const todas = await DB.all('guardias');
        return todas.filter(g => g.paramedico === p.nombre && !g.fecha_salida).sort((x, y) => y.id - x.id)[0] || null;
    }

    async function hSession() {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return sinPerfil();
        const g = await guardiaActiva(p);
        const seg = g ? Math.floor((Date.now() - parseLocal(g.fecha_entrada).getTime()) / 1000) : 0;
        return jsonResp({
            success: true, nombre_completo: p.nombre, primer_nombre: p.nombre.split(' ')[0], rol: p.rol,
            en_guardia: !!g, segundos_transcurridos: seg
        });
    }

    async function hFolio() {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return sinPerfil();
        const fraps = await DB.all('fraps');
        return jsonResp({ success: true, folio: siguienteFolio('CRM', fraps.map(f => f.folio)), nombre_paramedico: p.nombre });
    }

    async function hGuardia(fd) {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return jsonResp({ status: 'error', msg: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' });
        const qr = String(fd.get('qr_code') || '').trim();
        if (!qr) return jsonResp({ status: 'error', msg: 'Código no válido.' });
        const base = qr.replace(/_/g, ' ');
        const ahora = new Date();
        const hora = pad(ahora.getHours()) + ':' + pad(ahora.getMinutes());
        const activa = await guardiaActiva(p);

        if (activa) {
            const seg = (ahora.getTime() - parseLocal(activa.fecha_entrada).getTime()) / 1000;
            if (seg < 60) return jsonResp({ status: 'error', msg: 'Acabas de registrar tu entrada. Espera al menos un minuto para marcar salida.' });
            activa.fecha_salida = fechaLocalStr(ahora);
            activa.minutos_trabajados = Math.floor(seg / 60);
            await DB.put('guardias', activa);

            const todas = await DB.all('guardias');
            let totalSeg = 0;
            todas.forEach(g => {
                if (g.paramedico !== p.nombre || !g.fecha_salida) return;
                const e = parseLocal(g.fecha_entrada), s = parseLocal(g.fecha_salida);
                if (e && s && e.getMonth() === ahora.getMonth() && e.getFullYear() === ahora.getFullYear()) totalSeg += (s - e) / 1000;
            });
            const turno = horasMin(seg), mes = horasMin(totalSeg);
            const faltan = Math.max(0, META_HORAS_MES - mes.h);
            await Outbox.agregar({
                tipo: 'msg',
                html: '🔴 ' + b('FIN DE GUARDIA') + '\n🚑 ' + b('Voluntario:') + ' ' + esc(p.nombre) + '\n🕒 ' + b('Salida:') + ' ' + hora +
                    '\n⏱ ' + b('Tiempo en turno:') + ' ' + turno.h + 'h ' + turno.m + 'm\n\n📊 ' + b('PROGRESO MENSUAL') +
                    '\n✅ Realizadas: ' + mes.h + 'h ' + mes.m + 'm\n🎯 Faltan: ' + faltan + 'h para la meta de ' + META_HORAS_MES + 'h.'
            });
            Outbox.enviarPendientes();
            return jsonResp({ status: 'success', msg: 'Turno finalizado. Llevas ' + mes.h + 'h este mes.' + avisoSinTelegram() });
        }

        await DB.add('guardias', { paramedico: p.nombre, base, fecha_entrada: fechaLocalStr(ahora), fecha_salida: null, minutos_trabajados: 0 });
        await Outbox.agregar({
            tipo: 'msg',
            html: '🟢 ' + b('INICIO DE GUARDIA') + '\n🚑 ' + b('Voluntario:') + ' ' + esc(p.nombre) + '\n🏥 ' + b('Base:') + ' ' + esc(base) + '\n🕒 ' + b('Entrada:') + ' ' + hora
        });
        Outbox.enviarPendientes();
        return jsonResp({ status: 'success', msg: 'Guardia iniciada en ' + base + avisoSinTelegram() });
    }

    async function hServicio(metodo, query, cuerpo) {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return sinPerfil();
        const accion = (cuerpo && cuerpo.action) || query.get('action') || '';
        const todos = await DB.all('servicios');
        const activo = todos.filter(s => s.id_usuario === p.clave && s.estado === 'activo').sort((x, y) => y.id - x.id)[0] || null;

        if (accion === 'activo' && metodo === 'GET') return jsonResp({ success: true, servicio_activo: activo });

        if (accion === 'salida' && metodo === 'POST') {
            if (activo) return jsonResp({ success: true, servicio: activo, ya_existia: true });
            const d = cuerpo || {};
            const folio = siguienteFolio('SERV', todos.map(s => s.folio_servicio));
            const reg = {
                folio_servicio: folio, unidad: d.unidad || '', tipo_servicio: d.tipo_servicio || '', operador: d.operador || '',
                jefe_servicio: d.jefe_servicio || p.nombre, auxiliares: d.auxiliares || '', km_salida: d.km_salida || null,
                combustible_salida: d.combustible_salida || '', ubicacion_servicio: d.ubicacion_servicio || '',
                fecha_salida: fechaLocalStr(), km_llegada: null, combustible_llegada: null, hospital_traslado: null,
                fecha_llegada: null, estado: 'activo', id_usuario: p.clave, local_ref: d.local_servicio_ref || null
            };
            const id = await DB.add('servicios', reg);
            reservarFolio(folio);
            const v = (x) => esc(x || '—');
            await Outbox.agregar({
                tipo: 'msg',
                html: '🚑 ' + b('SALIDA A SERVICIO') + '\nFolio: ' + folio + '\nUnidad: ' + v(d.unidad) + '\nTipo: ' + v(d.tipo_servicio) +
                    '\nOperador: ' + v(d.operador) + '\nJefe de servicio: ' + esc(d.jefe_servicio || p.nombre) + '\nAuxiliares: ' + v(d.auxiliares) +
                    '\nKm de salida: ' + v(d.km_salida) + '\nCombustible: ' + v(d.combustible_salida) + '\nUbicación: ' + v(d.ubicacion_servicio)
            });
            Outbox.enviarPendientes();
            return jsonResp({ success: true, servicio: { id, folio_servicio: folio } });
        }

        if (accion === 'cierre' && metodo === 'POST') {
            const d = cuerpo || {};
            let s = null;
            if (d.servicio_id) s = todos.find(x => x.id === Number(d.servicio_id));
            if (!s && d.folio_servicio) s = todos.find(x => x.folio_servicio === d.folio_servicio);
            if (!s && d.local_servicio_ref) s = todos.find(x => x.local_ref === d.local_servicio_ref);
            if (!s) s = activo;
            if (!s) return jsonResp({ success: false, error: 'Falta identificar a qué servicio pertenece este cierre.' });
            s.km_llegada = d.km_llegada || null;
            s.combustible_llegada = d.combustible_llegada || '';
            s.hospital_traslado = d.hospital_traslado || '';
            s.fecha_llegada = fechaLocalStr();
            s.estado = 'cerrado';
            await DB.put('servicios', s);
            const v = (x) => esc(x || '—');
            await Outbox.agregar({
                tipo: 'msg',
                html: '🏁 ' + b('CIERRE DE SERVICIO') + '\nFolio: ' + esc(s.folio_servicio) + '\nUnidad: ' + v(s.unidad) + '\nOperador: ' + v(s.operador) +
                    '\nKm de llegada: ' + v(d.km_llegada) + '\nCombustible: ' + v(d.combustible_llegada) +
                    '\nHospital de traslado: ' + (d.hospital_traslado ? esc(d.hospital_traslado) : 'No aplicó')
            });
            Outbox.enviarPendientes();
            return jsonResp({ success: true });
        }
        return jsonResp({ success: false, error: 'Acción no reconocida.' }, 400);
    }

    const CHK_ITEMS = [
        'gasolina_validada', 'kilometraje_reportado', 'llaves_completas',
        'aceite_revisado', 'anticongelante_revisado', 'liquido_frenos', 'bateria_funcionando', 'llantas_buen_estado', 'refaccion_completa',
        'luces_funcionando', 'direccionales_funcionando', 'torretas_funcionando', 'sirena_funcionando', 'megafono_funcionando', 'camara_reversa_funcionando',
        'ambulancia_lavada', 'cabina_limpia', 'area_medica_sanitizada', 'camilla_limpia', 'tanques_oxigeno_revisados', 'equipo_medico_completo', 'rpbi_validado',
        'tarjeta_circulacion', 'seguro_vigente', 'bitacora_actualizada', 'extintor_vigente'
    ];
    const CHK_ETIQUETAS = {
        gasolina_validada: 'Gasolina validada', kilometraje_reportado: 'Kilometraje reportado', llaves_completas: 'Llaves completas',
        aceite_revisado: 'Aceite revisado', anticongelante_revisado: 'Anticongelante revisado', liquido_frenos: 'Líquido de frenos',
        bateria_funcionando: 'Batería funcionando', llantas_buen_estado: 'Llantas en buen estado', refaccion_completa: 'Llanta refacción + gato + llave',
        luces_funcionando: 'Luces funcionando', direccionales_funcionando: 'Direccionales funcionando', torretas_funcionando: 'Torretas funcionando',
        sirena_funcionando: 'Sirena funcionando', megafono_funcionando: 'Megáfono funcionando', camara_reversa_funcionando: 'Cámara de reversa funcionando',
        ambulancia_lavada: 'Ambulancia lavada', cabina_limpia: 'Cabina limpia', area_medica_sanitizada: 'Área médica sanitizada',
        camilla_limpia: 'Camilla limpia y funcional', tanques_oxigeno_revisados: 'Tanques de oxígeno revisados', equipo_medico_completo: 'Equipo médico completo', rpbi_validado: 'RPBI validado',
        tarjeta_circulacion: 'Tarjeta de circulación', seguro_vigente: 'Seguro vigente', bitacora_actualizada: 'Bitácora actualizada', extintor_vigente: 'Extintor vigente'
    };
    const CHK_SECCIONES = {
        '🚑 UNIDAD': ['gasolina_validada', 'kilometraje_reportado', 'llaves_completas'],
        '🔧 REVISIÓN MECÁNICA': ['aceite_revisado', 'anticongelante_revisado', 'liquido_frenos', 'bateria_funcionando', 'llantas_buen_estado', 'refaccion_completa'],
        '🚨 LUCES Y EMERGENCIA': ['luces_funcionando', 'direccionales_funcionando', 'torretas_funcionando', 'sirena_funcionando', 'megafono_funcionando', 'camara_reversa_funcionando'],
        '🧼 LIMPIEZA Y BIOSEGURIDAD': ['ambulancia_lavada', 'cabina_limpia', 'area_medica_sanitizada', 'camilla_limpia', 'tanques_oxigeno_revisados', 'equipo_medico_completo', 'rpbi_validado'],
        '📑 DOCUMENTACIÓN': ['tarjeta_circulacion', 'seguro_vigente', 'bitacora_actualizada', 'extintor_vigente']
    };

    async function hChecklist(cuerpo) {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return sinPerfil();
        const d = cuerpo || {};
        const todos = await DB.all('checklists');
        const folio = siguienteFolio('CHK', todos.map(c => c.folio_checklist));
        const reg = {
            folio_checklist: folio, operador: d.operador || p.nombre, id_usuario: p.clave, observaciones: d.observaciones || '',
            foto_gasolina: !!d.foto_gasolina, foto_kilometraje: !!d.foto_kilometraje, video_ambulancia: !!d.video_ambulancia, fecha: fechaLocalStr()
        };
        CHK_ITEMS.forEach(c => { reg[c] = !!d[c]; });
        await DB.add('checklists', reg);
        reservarFolio(folio);

        let t = '🟢 ' + b('CHECKLIST DIARIO AMBULANCIA') + ' 🚑\nFolio: ' + folio + '\nOperador: ' + esc(d.operador || p.nombre) + '\n\n';
        for (const titulo in CHK_SECCIONES) {
            t += titulo + '\n';
            CHK_SECCIONES[titulo].forEach(c => { t += CHK_ETIQUETAS[c] + ': ' + (d[c] ? '✅' : '❌') + '\n'; });
            t += '\n';
        }
        t += '📸 EVIDENCIA\nVideo de ambulancia: ' + (d.video_ambulancia ? '✅ (adjunto)' : '❌') +
            '\nFoto gasolina: ' + (d.foto_gasolina ? '✅ (adjunta)' : '❌') +
            '\nFoto kilometraje: ' + (d.foto_kilometraje ? '✅ (adjunta)' : '❌') + '\n\n';
        if (d.observaciones) t += '📝 Observaciones: ' + esc(d.observaciones) + '\n';

        await Outbox.agregar({ tipo: 'msg', html: t });
        if (d.foto_gasolina) await Outbox.agregar({ tipo: 'foto', blob: dataUrlABlob(d.foto_gasolina), caption: 'Foto gasolina - ' + folio });
        if (d.foto_kilometraje) await Outbox.agregar({ tipo: 'foto', blob: dataUrlABlob(d.foto_kilometraje), caption: 'Foto kilometraje - ' + folio });
        if (d.video_ambulancia) await Outbox.agregar({ tipo: 'video', blob: dataUrlABlob(d.video_ambulancia), caption: 'Video ambulancia - ' + folio });
        Outbox.enviarPendientes();
        return jsonResp({ success: true, folio });
    }

    function cargarScript(src) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
            document.head.appendChild(s);
        });
    }
    async function asegurarPdf() {
        if (!window.PDFLib) await cargarScript('vendor/pdf-lib.min.js');
        if (!window.FrapPdf) await cargarScript('frap-pdf.js');
    }

    async function hFrap(fd) {
        const p = Perfil.get();
        if (!p || !Perfil.sesionActiva()) return sinPerfil();
        const d = {};
        for (const [k, v] of fd.entries()) {
            if (k.indexOf('[]') !== -1) { (d[k] = d[k] || []).push(v); } else { d[k] = v; }
        }
        const fraps = await DB.all('fraps');
        let folio = d.folio;
        // Si el folio ya existe (dos formularios abiertos a la vez) o viene como
        // marcador viejo "PENDIENTE-...", se asigna el siguiente libre.
        if (!folio || String(folio).startsWith('PENDIENTE-') || fraps.some(f => f.folio === folio)) {
            folio = siguienteFolio('CRM', fraps.map(f => f.folio));
            d.folio = folio;
        }
        const ahora = new Date();
        try {
            await asegurarPdf();
            const bytes = await window.FrapPdf.generar(d, { perfil: p, fecha: ahora });
            const pdf = new Blob([bytes], { type: 'application/pdf' });
            await DB.put('fraps', {
                folio, fecha: fechaLocalStr(ahora), paramedico: p.nombre, paciente: d.nombre_paciente || 'No identificado',
                edad: d.edad || '', genero: d.genero || '', tipo_servicio: d.tipo_servicio || '', resolucion: d.resolucion_final || '',
                hospital: d.hospital_receptor || '', pdf, enviado: false
            });
            reservarFolio(folio);
            await Outbox.agregar({
                tipo: 'doc', blob: pdf, nombre: folio + '.pdf', frap: folio,
                caption: '🚨 ' + b('FRAP REGISTRADA') + ' 🚨\n\n📄 ' + b('Folio:') + ' ' + esc(folio) + '\n🚑 ' + b('Jefe de Servicio:') + ' ' + esc(p.nombre) +
                    '\n👤 ' + b('Paciente:') + ' ' + esc(d.nombre_paciente || 'No identificado') + '\n⚖️ ' + b('Dictamen:') + ' ' + esc(d.resolucion_final || '') +
                    (d.eval_pupilas ? '\n👁 ' + b('Pupilas:') + ' ' + esc(d.eval_pupilas) : '') +
                    (d.servicio_lat && d.servicio_lng ? '\n📍 ' + b('Ubicación:') + ' ' + esc(d.servicio_lat + ', ' + d.servicio_lng) + (d.servicio_precision ? ' (±' + esc(d.servicio_precision) + ' m)' : '') +
                        '\nhttps://www.google.com/maps?q=' + encodeURIComponent(d.servicio_lat + ',' + d.servicio_lng) : '')
            });
        } catch (e) {
            console.error('[frap] error generando PDF', e);
            return jsonResp({ success: false, error: 'No se pudo generar el PDF: ' + e.message }, 500);
        }
        Outbox.enviarPendientes();
        return jsonResp({ success: true, folio });
    }

    // ----------------------------------------------------------- enrutador
    async function atender(url, init) {
        const resto = url.slice(API.length);
        const q = resto.indexOf('?');
        const ruta = q === -1 ? resto : resto.slice(0, q);
        const query = new URLSearchParams(q === -1 ? '' : resto.slice(q + 1));
        const metodo = ((init && init.method) || 'GET').toUpperCase();
        const cuerpoRaw = init ? init.body : null;
        let fd = null, json = null;
        if (cuerpoRaw instanceof FormData) fd = cuerpoRaw;
        else if (typeof cuerpoRaw === 'string') { try { json = JSON.parse(cuerpoRaw); } catch (e) { json = null; } }

        try {
            switch (ruta) {
                case '/api/session.php': return await hSession();
                case '/api/folio.php': return await hFolio();
                case '/api/logout.php': Perfil.cerrarSesion(); return jsonResp({ success: true });
                case '/api/profile.php': {
                    const p = Perfil.get();
                    if (!p) return sinPerfil();
                    if (metodo === 'POST') return jsonResp({ success: false, error: 'La app ya no usa contraseña: tu perfil vive en este teléfono.' }, 400);
                    return jsonResp({ success: true, nombre_completo: p.nombre, rol: p.rol, usuario: p.clave, foto_url: null });
                }
                case '/api/profile_photo.php': return jsonResp({ success: true });
                case '/procesar_guardia.php': return await hGuardia(fd || new FormData());
                case '/api/servicio.php': return await hServicio(metodo, query, json);
                case '/api/checklist.php': return await hChecklist(json);
                case '/procesar.php': return await hFrap(fd || new FormData());
                default: return jsonResp({ success: false, error: 'Ruta no disponible en la versión local: ' + ruta }, 404);
            }
        } catch (e) {
            console.error('[local-core]', ruta, e);
            return jsonResp({ success: false, error: 'Error local: ' + e.message }, 500);
        }
    }

    const fetchReal = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf(API) === 0) return atender(url, init || {});
        return fetchReal(input, init);
    };

    // ------------------------------------------------- utilidades para pantallas
    async function exportarRespaldo() {
        const salida = { exportado: fechaLocalStr(), perfil: Perfil.get() };
        for (const n of ['guardias', 'servicios', 'checklists']) salida[n] = await DB.all(n);
        salida.fraps = (await DB.all('fraps')).map(f => { const c = Object.assign({}, f); delete c.pdf; return c; });
        return salida;
    }

    // Entrega un archivo al usuario: en la app de Android abre el menú "Compartir"
    // (WhatsApp, Drive, guardar en archivos...); en navegador lo descarga.
    function blobABase64(blob) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onloadend = () => res(String(r.result).split(',')[1]);
            r.onerror = rej;
            r.readAsDataURL(blob);
        });
    }
    async function entregarArchivo(nombre, blob) {
        const P = window.Capacitor && window.Capacitor.Plugins;
        if (P && P.Filesystem && P.Share) {
            const data = await blobABase64(blob);
            const r = await P.Filesystem.writeFile({ path: nombre, data, directory: 'CACHE' });
            await P.Share.share({ title: nombre, url: r.uri, dialogTitle: 'Compartir ' + nombre });
            return 'compartido';
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return 'descargado';
    }

    window.LocalApp = { Perfil, DB, TG, TgError, Outbox, esc, fechaLocalStr, parseLocal, horasMin, exportarRespaldo, entregarArchivo, META_HORAS_MES };
})();
