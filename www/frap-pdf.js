// frap-pdf.js
// ---------------------------------------------------------------------------
// Genera el PDF de la FRAP dentro del teléfono (antes lo hacía Dompdf en el
// servidor). Usa pdf-lib (vendor/pdf-lib.min.js), que funciona sin internet.
//
// El diseño replica la plantilla anterior: encabezado con logo y folio,
// secciones I–VI con barra de color, signos vitales con PAM, módulos extra
// (RCP, hemorragia, intoxicación, quemaduras, gineco-obstétrico) y tres firmas.
// El PDF además lleva adjunto un JSON con los datos de la FRAP (sin imágenes),
// por si algún día hay que reconstruir una base de datos desde los PDF.
// ---------------------------------------------------------------------------
(function () {
    'use strict';

    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

    const PW = 595.28, PH = 841.89, M = 28, CW = PW - 2 * M;
    const PADX = 4, PADY = 3, GAP = 7, PIE = 18;

    const hex = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
    const C = {
        rojo: hex('#cc0000'), borde: hex('#e0e0e0'), label: hex('#f8f9fa'), labelTxt: hex('#555555'),
        txt: hex('#111111'), gris: hex('#777777'), blanco: hex('#ffffff'), negro: hex('#000000')
    };

    // ----- texto seguro para las fuentes estándar del PDF (WinAnsi) -----------
    const WIN_EXTRA = '€…‘’“”•–—™';
    function limpiar(s) {
        s = String(s == null ? '' : s).replace(/\r\n?/g, '\n');
        let out = '';
        for (const ch of s) {
            const c = ch.codePointAt(0);
            if (ch === '\n') out += ch;
            else if (c < 32 || c === 127) out += ' ';
            else if (c <= 126 || (c >= 160 && c <= 255) || WIN_EXTRA.indexOf(ch) !== -1) out += ch;
            else if (c >= 0x1F000 || (c >= 0x2600 && c <= 0x27BF) || c === 0xFE0F || c === 0x200D || (c >= 0x300 && c <= 0x36F)) out += '';
            else out += '?';
        }
        return out;
    }
    // Datos del usuario: sin marcadores de negritas. B(x) marca negritas en la plantilla.
    const V = (x) => limpiar(x).replace(/[\u0001\u0002]/g, '');
    const B = (x) => '\u0001' + V(x) + '\u0002';
    const MAYUS = (x) => V(x).toUpperCase();

    // --------------------------------------------------------- medición / texto
    function envolver(str, size, maxW, fonts, baseBold, baseItalic) {
        const fuente = (negrita) => negrita ? fonts.bold : (baseItalic ? fonts.it : fonts.reg);
        const toks = [];
        let bold = baseBold, cur = '';
        const vaciar = () => { if (cur) { toks.push({ w: cur, b: bold }); cur = ''; } };
        for (const ch of str) {
            if (ch === '\u0001') { vaciar(); bold = true; }
            else if (ch === '\u0002') { vaciar(); bold = baseBold; }
            else if (ch === '\n') { vaciar(); toks.push({ nl: true }); }
            else if (ch === ' ') { vaciar(); toks.push({ sp: true, b: bold }); }
            else cur += ch;
        }
        vaciar();

        const lineas = [[]];
        let ancho = 0;
        const nueva = () => { lineas.push([]); ancho = 0; };
        for (const t of toks) {
            let linea = lineas[lineas.length - 1];
            if (t.nl) { nueva(); continue; }
            if (t.sp) {
                if (!linea.length) continue;
                const sw = fuente(t.b).widthOfTextAtSize(' ', size);
                if (ancho + sw > maxW) { nueva(); continue; }
                linea.push({ w: ' ', b: t.b, wd: sw }); ancho += sw; continue;
            }
            const f = fuente(t.b);
            let wd = f.widthOfTextAtSize(t.w, size);
            if (ancho + wd > maxW && linea.length) {
                while (linea.length && linea[linea.length - 1].w === ' ') ancho -= linea.pop().wd;
                nueva(); linea = lineas[lineas.length - 1];
            }
            if (wd > maxW) { // palabra más larga que la celda: se parte por caracteres
                let trozo = '';
                for (const ch of t.w) {
                    if (f.widthOfTextAtSize(trozo + ch, size) > maxW && trozo) {
                        lineas[lineas.length - 1].push({ w: trozo, b: t.b, wd: f.widthOfTextAtSize(trozo, size) });
                        nueva(); trozo = ch;
                    } else trozo += ch;
                }
                linea = lineas[lineas.length - 1];
                wd = f.widthOfTextAtSize(trozo, size);
                linea.push({ w: trozo, b: t.b, wd }); ancho += wd;
                continue;
            }
            linea.push({ w: t.w, b: t.b, wd }); ancho += wd;
        }
        while (lineas.length > 1 && !lineas[lineas.length - 1].length) lineas.pop();
        return lineas;
    }
    const anchoLinea = (l) => l.reduce((a, t) => a + t.wd, 0);

    class Lienzo {
        constructor(pdf, fonts) { this.pdf = pdf; this.f = fonts; this.nuevaPagina(); }
        nuevaPagina() { this.pag = this.pdf.addPage([PW, PH]); this.y = PH - M; this.segTop = null; }
        libre() { return this.y - (M + PIE); }

        texto(lineas, x, yTop, size, color, ancho, alinear, italica) {
            const lh = size * 1.25;
            lineas.forEach((l, i) => {
                const base = yTop - (i + 1) * lh + size * 0.28;
                let px = x;
                if (alinear === 'c') px = x + (ancho - anchoLinea(l)) / 2;
                else if (alinear === 'd') px = x + ancho - anchoLinea(l);
                l.forEach(t => {
                    if (t.w === ' ') { px += t.wd; return; }
                    this.pag.drawText(t.w, { x: px, y: base, size, font: t.b ? this.f.bold : (italica ? this.f.it : this.f.reg), color });
                    px += t.wd;
                });
            });
        }

        // Mide una fila: cada celda ocupa `span` columnas de `anchos` (fracciones).
        medir(celdas, anchos) {
            const total = anchos.reduce((a, b) => a + b, 0);
            let col = 0, x = M;
            return celdas.map(c => {
                const span = c.span || 1;
                const fr = anchos.slice(col, col + span).reduce((a, b) => a + b, 0);
                const w = CW * fr / total;
                const m = Object.assign({}, c, { x, w });
                col += span; x += w;
                const label = c.k === 'l';
                m.size = c.size || (label ? 6.6 : 8);
                m.lh = m.size * 1.25;
                if (c.img) {
                    const k = Math.min((w - 2 * PADX) / c.img.width, c.maxH / c.img.height, 1);
                    m.iw = c.img.width * k; m.ih = c.img.height * k;
                    m.lineas = []; m.alto = m.ih + 2 * PADY;
                } else {
                    const txt = label ? MAYUS(c.t) : c.t;
                    m.lineas = envolver(txt, m.size, w - 2 * PADX, this.f, label || !!c.bold, !!c.it);
                    m.alto = Math.max(1, m.lineas.length) * m.lh + 2 * PADY;
                }
                return m;
            });
        }
        altoFila(m) { return Math.max.apply(null, m.map(c => c.alto)); }

        dibujarFila(m, h, lineasPorCelda) {
            const top = this.y;
            m.forEach((c, i) => {
                const fondo = c.bg ? hex(c.bg) : (c.k === 'l' ? C.label : null);
                this.pag.drawRectangle({ x: c.x, y: top - h, width: c.w, height: h, color: fondo || undefined, borderColor: C.borde, borderWidth: 0.5 });
                if (c.img) {
                    this.pag.drawImage(c.img, { x: c.x + (c.w - c.iw) / 2, y: top - (h + c.ih) / 2, width: c.iw, height: c.ih });
                    return;
                }
                const lineas = lineasPorCelda ? lineasPorCelda[i] : c.lineas;
                const color = c.color ? hex(c.color) : (c.k === 'l' ? C.labelTxt : C.txt);
                this.texto(lineas, c.x + PADX, top - PADY, c.size, color, c.w - 2 * PADX, c.al, c.it);
            });
            this.y -= h;
        }

        cerrarSegmento(color) {
            if (this.segTop === null) return;
            const alto = this.segTop - this.y;
            if (alto > 0) this.pag.drawRectangle({ x: M, y: this.y, width: CW, height: alto, borderColor: color, borderWidth: 0.9 });
            this.segTop = null;
        }

        barraTitulo(titulo, color, cont) {
            const h = 14;
            this.pag.drawRectangle({ x: M, y: this.y - h, width: CW, height: h, color });
            this.pag.drawText(V(titulo).toUpperCase() + (cont ? '  (continuación)' : ''), { x: M + 5, y: this.y - h + 4.3, size: 8, font: this.f.bold, color: C.blanco });
            this.y -= h;
        }

        // Una sección con borde de color y tabla de filas.
        seccion(titulo, colorHex, anchos, filas) {
            const color = hex(colorHex);
            const medidas = filas.map(f => this.medir(f, anchos));
            const primera = medidas.length ? this.altoFila(medidas[0]) : 0;
            if (this.libre() < 14 + Math.min(primera, 90)) this.nuevaPagina();
            this.barraTitulo(titulo, color, false);
            this.segTop = this.y + 14;
            medidas.forEach(m => {
                let h = this.altoFila(m);
                if (h > this.libre()) {
                    const pagina = PH - 2 * M - PIE - 14;
                    if (h <= pagina) {
                        this.cerrarSegmento(color); this.nuevaPagina(); this.barraTitulo(titulo, color, true); this.segTop = this.y + 14;
                    } else { this.filaPartida(m, color, titulo); return; }
                }
                this.dibujarFila(m, h);
            });
            this.cerrarSegmento(color);
            this.y -= GAP;
        }

        // Fila más alta que una hoja (narrativa muy larga): se reparte por líneas.
        filaPartida(m, color, titulo) {
            const idx = m.reduce((mx, c, i) => c.alto > m[mx].alto ? i : mx, 0);
            let resto = m[idx].lineas.slice();
            let primera = true;
            while (resto.length) {
                if (this.libre() < 60) { this.cerrarSegmento(color); this.nuevaPagina(); this.barraTitulo(titulo, color, true); this.segTop = this.y + 14; }
                const cab = Math.max(1, Math.floor((this.libre() - 2 * PADY) / m[idx].lh));
                const trozo = resto.splice(0, cab);
                const lineasPorCelda = m.map((c, i) => i === idx ? trozo : (primera ? c.lineas : []));
                this.dibujarFila(m, trozo.length * m[idx].lh + 2 * PADY, lineasPorCelda);
                primera = false;
            }
        }

        espacio(h) { if (this.libre() < h) this.nuevaPagina(); }
    }

    // ----------------------------------------------------------------- datos
    function formatearFecha(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

    async function cargarPng(pdf, dataUrl) {
        if (!dataUrl || dataUrl.indexOf('base64,') === -1) return null;
        try {
            const bin = atob(dataUrl.split('base64,')[1]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return dataUrl.indexOf('image/jpeg') !== -1 ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
        } catch (e) { console.warn('[pdf] imagen ignorada', e); return null; }
    }
    // Datos de la institución (los captura cada usuario en Ajustes; el logo es opcional).
    function leerInstitucion() {
        try { return Object.assign({ nombre: '', sub: '', logo: '' }, JSON.parse(localStorage.getItem('institucion') || 'null') || {}); }
        catch (e) { return { nombre: '', sub: '', logo: '' }; }
    }
    async function cargarLogo(pdf, inst) {
        try {
            if (!inst.logo) return null;
            const bin = atob(inst.logo.split('base64,')[1]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return inst.logo.indexOf('image/jpeg') !== -1 ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
        } catch (e) { return null; }
    }

    async function generar(d, ctx) {
        const perfil = (ctx && ctx.perfil) || { nombre: '' };
        const fecha = (ctx && ctx.fecha) || new Date();

        const inst = leerInstitucion();
        // Helpers que imitan $_POST['x'] ?? 'valor'
        const g = (k, def) => (d[k] === undefined || d[k] === null) ? (def === undefined ? '' : def) : d[k];
        const ne = (k) => { const v = d[k]; return (v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0) ? v : null; };
        const arr = (k) => Array.isArray(d[k]) ? d[k] : (d[k] !== undefined && d[k] !== '' ? [d[k]] : []);
        const unir = (partes) => partes.filter(x => x && String(x).trim() !== '').join(' | ');

        const folio = g('folio', 'SIN_FOLIO');
        const paramedico = perfil.nombre || 'Desconocido';

        // --- evaluación A-B-C (mismas reglas que procesar.php) ---
        const evalViaAerea = (g('form_via_aerea') + (g('form_deglucion') ? ' | Deglución: ' + g('form_deglucion') : '')).trim();
        const evalVent = (g('form_vent_obs') + (g('form_vent_ausc') ? ' | Ausc: ' + g('form_vent_ausc') + ' (' + g('form_vent_hemi') + ' - ' + g('form_vent_sitio') + ')' : '')).trim();
        const evalPulsos = (g('form_pulso_presencia') + (g('form_pulso_calidad') ? ' | Calidad: ' + g('form_pulso_calidad') : '')).trim();
        const evalPiel = (g('form_piel_color') + (g('form_piel_estado') ? ' | Características: ' + g('form_piel_estado') : '')).trim();
        const gcsTotal = ne('glasgow_total');
        const textoGcs = gcsTotal ? 'O:' + g('glasgow_ocular') + ' V:' + g('glasgow_verbal') + ' M:' + g('glasgow_motora') + ' = ' + gcsTotal + ' (' + g('glasgow_severidad') + ')' : 'No evaluado';

        // --- tratamientos ---
        const ventFull = g('form_trat_ventilacion') + (g('form_trat_vent_detalles') ? ' (' + g('form_trat_vent_detalles') + ')' : '');
        const tratVia = unir([g('form_trat_via_aerea'), g('form_trat_cervical') ? 'Cervical: ' + g('form_trat_cervical') : '', ventFull ? 'Vent: ' + ventFull : '']) || 'Ninguno';
        const tratO2 = unir([g('form_trat_oxigeno'), g('form_trat_o2_lts') ? g('form_trat_o2_lts') + ' Lts/Min' : '']) || 'No';
        const tratAcceso = unir([g('form_trat_via_linea') ? 'Línea #' + g('form_trat_via_linea') : '', g('form_trat_via_cateter') ? 'Catéter #' + g('form_trat_via_cateter') : '', g('form_trat_via_sitio') ? 'Sitio: ' + g('form_trat_via_sitio') : '']) || 'Ninguno';
        const tratSolucion = g('form_trat_solucion_tipo', 'Ninguna');
        const tratVolumen = unir([g('form_trat_solucion_cantidad') ? 'Cant: ' + g('form_trat_solucion_cantidad') : '', g('form_trat_solucion_infusiones') ? 'Infusiones: ' + g('form_trat_solucion_infusiones') : '']);

        // --- signos vitales ---
        const horas = arr('sv_hora[]');
        const tomas = [];
        horas.forEach((h, i) => {
            if (!h) return;
            const x = (k) => { const v = arr(k)[i]; return (v !== undefined && v !== null && v !== '' && v !== '0') ? v : '-'; };
            tomas.push({ hora: h, fc: x('sv_fc[]'), fr: x('sv_fr[]'), tas: x('sv_tas[]'), tad: x('sv_tad[]'), sao2: x('sv_sao2[]'), temp: x('sv_temp[]'), glucosa: x('sv_glucosa[]') });
        });

        // --- documento ---
        const pdf = await PDFDocument.create();
        pdf.setTitle('FRAP ' + V(folio));
        pdf.setAuthor(V(paramedico));
        pdf.setSubject('Registro de Atención Prehospitalaria' + (inst.nombre ? ' - ' + V(inst.nombre) : ''));
        pdf.setProducer('FRAP Digital CRM (local)');
        pdf.setCreationDate(fecha);
        const fonts = {
            reg: await pdf.embedFont(StandardFonts.Helvetica),
            bold: await pdf.embedFont(StandardFonts.HelveticaBold),
            it: await pdf.embedFont(StandardFonts.HelveticaOblique)
        };
        const L = new Lienzo(pdf, fonts);
        const logo = await cargarLogo(pdf, inst);
        const imgMedico = await cargarPng(pdf, d.base64_firma_medico);
        const imgPaciente = await cargarPng(pdf, d.base64_firma_paciente);
        const imgParamedico = await cargarPng(pdf, d.base64_firma_paramedico);
        const imgMapa = await cargarPng(pdf, d.base64_mapa_lesiones);

        // Encabezado
        const altoCab = 44;
        if (logo) {
            const k = 40 / logo.height;
            L.pag.drawImage(logo, { x: M, y: L.y - 40, width: logo.width * k, height: 40 });
        } else {
            L.pag.drawText(V(inst.nombre || 'FRAP DIGITAL').toUpperCase(), { x: M, y: L.y - 24, size: 15, font: fonts.bold, color: C.rojo });
        }
        const tituloCab = 'REGISTRO DE ATENCIÓN PREHOSPITALARIA';
        L.pag.drawText(tituloCab, { x: PW - M - fonts.bold.widthOfTextAtSize(tituloCab, 13), y: L.y - 13, size: 13, font: fonts.bold, color: C.rojo });
        const deleg = V(inst.sub || '').toUpperCase();
        if (deleg) L.pag.drawText(deleg, { x: PW - M - fonts.bold.widthOfTextAtSize(deleg, 8), y: L.y - 25, size: 8, font: fonts.bold, color: hex('#555555') });
        const fTxt = V(folio), fEt = 'FOLIO: ';
        const wF = fonts.bold.widthOfTextAtSize(fTxt, 11), wE = fonts.bold.widthOfTextAtSize(fEt, 11);
        L.pag.drawText(fEt, { x: PW - M - wF - wE, y: L.y - 39, size: 11, font: fonts.bold, color: C.negro });
        L.pag.drawText(fTxt, { x: PW - M - wF, y: L.y - 39, size: 11, font: fonts.bold, color: C.rojo });
        L.y -= altoCab + 4;
        L.pag.drawLine({ start: { x: M, y: L.y }, end: { x: PW - M, y: L.y }, thickness: 2.2, color: C.rojo });
        L.y -= 9;

        const l = (t, o) => Object.assign({ t, k: 'l' }, o || {});
        const v = (t, o) => Object.assign({ t, k: 'v' }, o || {});
        const A4 = [18, 32, 18, 32];

        // I. Servicio y tripulación
        L.seccion('I. Datos del Servicio y Tripulación', '#cc0000', A4, [
            [l('Fecha / Tipo'), v(formatearFecha(fecha) + ' | ' + B(g('tipo_servicio'))), l('Motivo atención'), v(V(g('motivo_atencion')) + ' (Pri: ' + V(g('prioridad_inicial')) + ')')],
            [l('Ubicación'), v(V(g('servicio_esquina')) + ', Mun. ' + V(g('servicio_municipio')) + ' (' + V(g('servicio_lugar_ocurrencia')) + ')' +
                (ne('servicio_lat') && ne('servicio_lng') ? ' | ' + B('GPS: ') + V(ne('servicio_lat')) + ', ' + V(ne('servicio_lng')) + (ne('servicio_precision') ? ' (±' + V(ne('servicio_precision')) + ' m)' : '') : ''), { span: 3 })],
            [l('Tripulación'), v(B('Jefe: ') + V(paramedico) + ' | ' + B('Op: ') + V(g('tripulacion_operador')) + ' | ' + B('Aux: ') + V(g('tripulacion_auxiliares')), { span: 3 })],
            [l('Cronometría'), v('Llamada: ' + V(ne('hora_llamada') || '--:--') + ' | Salida: ' + V(ne('hora_salida') || '--:--') + ' | Llegada: ' + V(ne('hora_llegada') || '--:--') +
                ' | Traslado: ' + V(ne('hora_traslado') || '--:--') + ' | Hosp: ' + V(ne('hora_hospital') || '--:--') + ' | ' + B('Base: ' + (ne('hora_base') || '--:--')), { span: 3 })]
        ]);

        // II. Paciente
        L.seccion('II. Datos del Paciente', '#cc0000', A4, [
            [l('Nombre'), v(B(g('nombre_paciente', 'No identificado')), { span: 3 })],
            [l('Edad / Género'), v(V(g('edad')) + ' años / ' + V(g('genero'))), l('Tel / Ocupación'), v(V(g('paciente_telefono')) + ' | ' + V(g('paciente_ocupacion')))],
            [l('Domicilio'), v(V(g('domicilio_paciente', 'No proporcionado')) + ' (C.P. ' + V(g('paciente_cp')) + ')', { span: 3 })]
        ]);

        // III. Evaluación clínica
        L.seccion('III. Evaluación Clínica y SAMPLER', '#cc0000', A4, [
            [l('Vía aérea / Vent.'), v(V(evalViaAerea) + ' | ' + V(evalVent)), l('Glasgow (GCS)'), v(B(textoGcs))],
            [l('Pulsos / Piel'), v(V(evalPulsos) + ' | ' + V(evalPiel)),
                ...(ne('pupila_od') && ne('pupila_oi') ? [l('Auscultación'), v(V(g('eval_auscultacion', '-')))] : [l('Pupilas / Ausc.'), v(V(g('eval_pupilas', '-')) + ' | ' + V(g('eval_auscultacion', '-')))])],
            ...(ne('pupila_od') && ne('pupila_oi') ? [[l('Pupilas'), v(B('OD: ') + V(ne('pupila_od')) + ' mm  |  ' + B('OI: ') + V(ne('pupila_oi')) + ' mm  |  ' + B('Reacción a la luz: ') + V(g('pupila_reactividad', '') || 'No valorada') +
                (ne('eval_pupilas') ? '  |  ' + V(g('eval_pupilas')) : ''), { span: 3 })]] : []),
            [l('SAMPLER'), v(B('S: ') + V(g('sampler_signos', '-')) + '  ' + B('A: ') + V(g('sampler_alergias', '-')) + '  ' + B('M: ') + V(g('sampler_medicamentos', '-')) + '  ' + B('P: ') + V(g('sampler_padecimientos', '-')) +
                '\n' + B('L: ') + V(g('sampler_ultima_comida', '-')) + '  ' + B('E: ') + V(g('sampler_eventos', '-')) + '  ' + B('R: ') + V(g('sampler_riesgos', '-')), { span: 3 })],
            [l('Dolor (ALICIA)'), v(B('Aparición: ') + V(g('dolor_aparicion', '-')) + ' | ' + B('Localiz: ') + V(g('dolor_localizacion', '-')) + ' | ' + B('Irradiac: ') + V(g('dolor_irradiacion', '-')) +
                ' | ' + B('Caract: ') + V(g('dolor_caracteristicas', '-')) + ' | ' + B('Intensidad: ') + V(g('dolor_intensidad', '-')) + ' | ' + B('Alivio: ') + V(g('dolor_alivio', '-')), { span: 3 })]
        ]);

        // Situaciones críticas
        const hemo = g('hemorragia_tipo', 'Ninguna');
        const hayHemo = hemo !== 'Ninguna' && hemo !== '';
        const hayTox = g('intoxicacion_aplica', 'No') === 'Sí';
        const hayQuem = g('quemados_aplica', 'No') === 'Sí';
        if (hayHemo || hayTox || hayQuem) {
            const filas = [];
            if (hayHemo) filas.push(
                [v('[X] CONTROL DE HEMORRAGIA', { span: 4, bg: '#fdebd0', color: '#cc0000', bold: true, size: 7.5 })],
                [l('Tipo'), v(V(hemo)), l('Control'), v(V(g('hemorragia_control', 'Ninguno')) + ' (' + V(g('hemorragia_torniquete_detalles')) + ')')]);
            if (hayTox) filas.push(
                [v('[TOX] INTOXICACIÓN / ENVENENAMIENTO', { span: 4, bg: '#d6eaf8', color: '#0056b3', bold: true, size: 7.5 })],
                [l('Vía'), v(V(g('intoxicacion_via'))), l('Tiempo'), v(V(g('intoxicacion_tiempo')))],
                [l('Agente'), v(V(g('intoxicacion_sustancia'))), l('Síntomas'), v(V(g('intoxicacion_sintomas')))]);
            if (hayQuem) filas.push(
                [v('[QUEM] QUEMADURAS', { span: 4, bg: '#fadbd8', color: '#c0392b', bold: true, size: 7.5 })],
                [l('Grado'), v(V(g('quemados_grado'))), l('SCQ %'), v(B(g('quemados_porcentaje') + '%'))],
                [l('Regiones'), v(V(g('quemados_regiones')), { span: 3 })]);
            L.seccion('Situaciones críticas (X / TOX / Quemados)', '#d35400', A4, filas);
        }

        // Gineco-obstétrico
        if (g('gineco_aplica', 'No') === 'Sí') {
            const filas = [
                [l('Antecedentes'), v('Gestas: ' + V(g('gineco_g')) + ' | Partos: ' + V(g('gineco_p')) + ' | Cesáreas: ' + V(g('gineco_c')) + ' | Abortos: ' + V(g('gineco_a')), { span: 3 })],
                [l('Semanas (SDG)'), v(V(g('gineco_sdg'))), l('FCF'), v(V(g('gineco_fcf')) + ' lpm')],
                [l('Contracc.'), v(V(g('gineco_contracciones')) + ' (' + V(g('gineco_duracion')) + ')'), l('Líquido'), v(V(g('gineco_liquido')))]
            ];
            if (g('parto_aplica', 'No') === 'Sí') filas.push(
                [v('DATOS DEL RECIÉN NACIDO', { span: 4, bg: '#f5b7b1', color: '#78281f', bold: true, size: 7.5 })],
                [l('Hora nacim.'), v(V(g('parto_hora_nacimiento'))), l('Sexo'), v(V(g('parto_sexo')))],
                [l('APGAR'), v(B(g('parto_apgar_1') + ' Pts') + ' (' + V(g('parto_apgar_eval')) + ')'), l('Reanimación'), v(V(g('parto_reanimacion')))],
                [l('H. placenta'), v(V(g('parto_hora_placenta'))), l('Observac.'), v(V(g('parto_complicaciones')))]);
            L.seccion('Evaluación gineco-obstétrica y parto', '#8e44ad', A4, filas);
        }

        // Signos vitales
        if (tomas.length) {
            const cab = ['Hora', 'FC', 'FR', 'TAS', 'TAD', 'PAM', 'SaO2%', 'Temp', 'Glucosa'].map(t => ({ t, k: 'l', al: 'c', size: 7, span: 1 }));
            const filas = [cab];
            tomas.forEach(t => {
                const pam = (isFinite(parseFloat(t.tas)) && isFinite(parseFloat(t.tad))) ? Math.round((parseFloat(t.tas) + 2 * parseFloat(t.tad)) / 3) : '-';
                filas.push([t.hora, t.fc, t.fr, t.tas, t.tad, B(pam), t.sao2, t.temp, t.glucosa].map(x => ({ t: V(x) === '' ? '-' : (typeof x === 'string' && x.indexOf('\u0001') === 0 ? x : V(x)), k: 'v', al: 'c' })));
            });
            L.seccion('Signos vitales y PAM', '#cc0000', [1.1, 1, 1, 1, 1, 1, 1, 1, 1.2], filas);
        }

        // IV. Trauma
        const rts = g('trauma_score') !== '' ? '\n' + B('RTS (Trauma Score): ') + V(g('trauma_score')) + ' Pts - ' + V(g('trauma_score_eval')) : '';
        L.seccion('IV. Trauma y Lesiones', '#cc0000', [15, 50, 35], [[
            l('Cinemática'),
            v(B('Impacto: ') + V(g('trauma_impacto', 'No aplica')) + '\n' + B('Cinturón/Casco: ') + V(g('trauma_cinturon', 'No aplica')) + '\n' + B('Bolsas: ') + V(g('trauma_bolsas', 'No aplica')) +
                '\n' + B('Estado: ') + V(g('trauma_estado', 'No aplica')) + rts),
            imgMapa ? { k: 'v', img: imgMapa, maxH: 110 } : v('Sin mapa corporal', { it: true, al: 'c', color: '#999999' })
        ]]);

        // V. Tratamiento y resolución
        L.seccion('V. Tratamiento y Resolución del Servicio', '#cc0000', A4, [
            [l('V. aérea / O2'), v(V(tratVia) + ' | ' + V(tratO2)), l('Acceso venoso'), v(V(tratAcceso) + ' (' + V(tratSolucion) + ' - ' + V(tratVolumen) + ')')],
            ...(ne('insumos_utilizados') ? [[l('Insumos'), v(V(g('insumos_utilizados')), { span: 3 })]] : []),
            [l('Narrativa / Obs.'), v(V(g('observaciones')), { span: 3 })],
            [l('Dictamen'), v(B(g('resolucion_final')) + ' | Triage: ' + V(g('triage_final')) + ' | Vehículo: ' + V(g('vehiculo_traslado')), { span: 3, size: 8.6 })],
            [l('Hospital rec.'), v(V(g('hospital_receptor', 'No ameritó traslado'))), l('Médico recibe'), v(V(g('medico_recibe')))]
        ]);

        // RCP
        if (g('rcp_iniciado', 'No') === 'Sí') {
            L.seccion('Bitácora de reanimación (RCP)', '#000000', A4, [
                [l('Inicio'), v(V(g('rcp_hora_inicio'))), l('Ritmo inicial'), v(V(g('rcp_ritmo_inicial', '-')))],
                [l('Desfibrilación'), v(V(g('rcp_desfibrilacion', 'No')) + ' (' + V(ne('rcp_numero_descargas') || 0) + ' descargas)'), l('Fármacos'), v(V(g('rcp_medicamentos', '-')))],
                [l('Resultado'), v(B(g('rcp_resultado', '-'))), l('Hora final/cese'), v(V(g('rcp_hora_final')))]
            ]);
        }

        // VI. Marco legal
        const tipoCons = g('tipo_consentimiento', 'Consentimiento Informado');
        const textoLegal = tipoCons === 'Consentimiento Informado'
            ? 'DECLARO HABER RECIBIDO OPORTUNAMENTE INFORMACIÓN COMPLETA Y ADECUADA SOBRE MI CUADRO CLÍNICO Y LOS PROCEDIMIENTOS DIAGNÓSTICOS Y/O TERAPÉUTICOS. DECLARO MI CONSENTIMIENTO PARA SER SOMETIDO AL TRATAMIENTO.'
            : 'DECLARO QUE NO ACEPTO LAS RECOMENDACIONES DEL PERSONAL DE LA AMBULANCIA EN CUANTO AL TRATAMIENTO Y/O TRASLADO. EXIMO A ' + (inst.nombre ? V(inst.nombre).toUpperCase() : 'LA INSTITUCIÓN') + ' DE TODA RESPONSABILIDAD.';
        const filasLegal = [[v('"' + textoLegal + '"', { it: true, size: 7.5, color: '#555555' })]];
        if (ne('autoridad_corporacion') || ne('autoridad_oficial') || ne('autoridad_unidad')) {
            filasLegal.push([v(B('Autoridad: ') + V(g('autoridad_corporacion')) + ' | ' + B('Oficial: ') + V(g('autoridad_oficial')) + ' | ' + B('Unidad: ') + V(g('autoridad_unidad')), { size: 7.5 })]);
        }
        if (ne('pertenencias_recibe')) filasLegal.push([v(B('Pertenencias recibe: ') + V(g('pertenencias_recibe')), { size: 7.5 })]);
        L.seccion('VI. Marco legal - ' + V(tipoCons), '#34495e', [1], filasLegal);

        // Firmas
        const nombrePac = V(g('nombre_firma_paciente')).trim() !== '' ? V(g('nombre_firma_paciente')) : 'Paciente / Familiar / Testigo';
        const cajas = [
            { img: imgMedico, t1: 'MÉDICO RECEPTOR', t2: V(g('medico_recibe')) },
            { img: imgPaciente, t1: nombrePac.toUpperCase(), t2: 'Paciente / Familiar' },
            { img: imgParamedico, t1: 'JEFE DE SERVICIO', t2: V(paramedico).toUpperCase() }
        ];
        L.espacio(105);
        const wCaja = CW / 3, yLinea = L.y - 66;
        cajas.forEach((c, i) => {
            const x0 = M + i * wCaja;
            if (c.img) {
                const k = Math.min(55 / c.img.height, (wCaja * 0.8) / c.img.width, 1);
                const w = c.img.width * k, h = c.img.height * k;
                L.pag.drawImage(c.img, { x: x0 + (wCaja - w) / 2, y: yLinea + 3, width: w, height: h });
            }
            L.pag.drawLine({ start: { x: x0 + wCaja * 0.1, y: yLinea }, end: { x: x0 + wCaja * 0.9, y: yLinea }, thickness: 0.8, color: C.negro });
            [[c.t1, fonts.bold, 7.5], [c.t2, fonts.reg, 7.5]].forEach(([t, f, s], j) => {
                const lin = envolver(t, s, wCaja * 0.9, fonts, f === fonts.bold, false);
                lin.slice(0, 2).forEach((ln, q) => {
                    const w = anchoLinea(ln);
                    let px = x0 + (wCaja - w) / 2;
                    ln.forEach(tk => { if (tk.w !== ' ') L.pag.drawText(tk.w, { x: px, y: yLinea - 10 - (j * 11) - q * 9, size: s, font: f, color: C.negro }); px += tk.wd; });
                });
            });
        });
        L.y = yLinea - 40;

        // Pie de página
        const paginas = pdf.getPages();
        paginas.forEach((pg, i) => {
            const t = 'Folio ' + V(folio) + '  -  Página ' + (i + 1) + ' de ' + paginas.length;
            pg.drawText(t, { x: (PW - fonts.reg.widthOfTextAtSize(t, 6.5)) / 2, y: 16, size: 6.5, font: fonts.reg, color: C.gris });
        });

        // Datos en crudo (sin imágenes) adjuntos al PDF
        const crudo = {};
        Object.keys(d).forEach(k => { if (k.indexOf('base64_') !== 0) crudo[k] = d[k]; });
        crudo._generado = fecha.toISOString();
        crudo._jefe_servicio = paramedico;
        try {
            await pdf.attach(new TextEncoder().encode(JSON.stringify(crudo, null, 1)), 'frap-datos.json', {
                mimeType: 'application/json', description: 'Datos de la FRAP ' + V(folio), creationDate: fecha, modificationDate: fecha
            });
        } catch (e) { console.warn('[pdf] no se pudo adjuntar JSON', e); }

        return await pdf.save();
    }

    window.FrapPdf = { generar };
})();
