// ojos-pupilas.js — evaluación de pupilas con dos ojos dibujados que cambian de tamaño en vivo.
//
// Campos que llena (todos viajan con el formulario, el PDF y el mensaje de Telegram):
//   pupila_od, pupila_oi          tamaño en mm (ojo derecho / ojo izquierdo del paciente)
//   pupila_reactividad            Reactivas | Lentas | Arreactivas
//   eval_pupilas                  texto resumen, por ejemplo "Midriáticas 7 mm, reactivas"
(function () {
    'use strict';

    var MIN = 1, MAX = 9, ESCALA = 2.6;            // radio dibujado = mm * ESCALA
    var PRESETS = {
        miosis: { od: 2, oi: 2 },
        normal: { od: 4, oi: 4 },
        midriasis: { od: 7, oi: 7 },
        aniso: { od: 3, oi: 6 }
    };

    function ojoSVG(id) {
        return '<svg viewBox="0 0 120 80" class="ojo-svg" role="img" aria-label="Ojo">' +
            '<defs><clipPath id="clip' + id + '"><path d="M6 40 Q60 -4 114 40 Q60 84 6 40 Z"/></clipPath>' +
            '<radialGradient id="iris' + id + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#7a5a2e"/><stop offset=".6" stop-color="#5b3d1d"/><stop offset="1" stop-color="#2d1d0c"/></radialGradient></defs>' +
            '<path d="M6 40 Q60 -4 114 40 Q60 84 6 40 Z" fill="#f4efe9" stroke="#1b1b24" stroke-width="2.5" stroke-linejoin="round"/>' +
            '<g clip-path="url(#clip' + id + ')">' +
                '<circle cx="60" cy="40" r="27" fill="url(#iris' + id + ')"/>' +
                '<circle cx="60" cy="40" r="27" fill="none" stroke="#1b1208" stroke-width="2"/>' +
                '<circle class="ojo-pupila" cx="60" cy="40" r="10" fill="#050505"/>' +
                '<circle cx="52" cy="31" r="4" fill="#fff" opacity=".85"/>' +
                '<circle cx="69" cy="48" r="1.8" fill="#fff" opacity=".55"/>' +
                '<path d="M6 40 Q60 -4 114 40 L114 -10 L6 -10 Z" fill="#000" opacity=".16"/>' +
            '</g></svg>';
    }

    function montar(raiz) {
        var q = function (s) { return raiz.querySelector(s); };
        var campoTexto = document.querySelector('[name="eval_pupilas"]');
        var hOD = document.getElementById('pupila_od');
        var hOI = document.getElementById('pupila_oi');
        var hRe = document.getElementById('pupila_reactividad');

        q('.ojo-od').innerHTML = ojoSVG('D');
        q('.ojo-oi').innerHTML = ojoSVG('I');
        var pOD = q('.ojo-od .ojo-pupila'), pOI = q('.ojo-oi .ojo-pupila');
        var sOD = q('#ojoSlOD'), sOI = q('#ojoSlOI');

        var visual = { od: 4, oi: 4 };      // lo que se está dibujando ahora (puede ser menor por el reflejo a la luz)
        var anim = null, tocado = false, probando = false;

        function dibujar() {
            pOD.setAttribute('r', (visual.od * ESCALA).toFixed(2));
            pOI.setAttribute('r', (visual.oi * ESCALA).toFixed(2));
        }

        function animar(haciaOD, haciaOI, ms, fin) {
            if (anim) cancelAnimationFrame(anim);
            var d0 = visual.od, i0 = visual.oi, t0 = null;
            function paso(t) {
                if (t0 === null) t0 = t;
                var k = Math.min(1, (t - t0) / ms);
                var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                visual.od = d0 + (haciaOD - d0) * e;
                visual.oi = i0 + (haciaOI - i0) * e;
                dibujar();
                if (k < 1) anim = requestAnimationFrame(paso); else { anim = null; if (fin) fin(); }
            }
            anim = requestAnimationFrame(paso);
        }

        function estado(od, oi) {
            if (Math.abs(od - oi) >= 1) return 'Anisocóricas';
            var m = (od + oi) / 2;
            if (m <= 2) return 'Mióticas';
            if (m >= 6) return 'Midriáticas';
            return 'Isocóricas';
        }

        function num(n) { return (Math.round(n * 2) / 2).toString().replace('.', ','); }

        function resumen() {
            var od = parseFloat(sOD.value), oi = parseFloat(sOI.value);
            var e = estado(od, oi);
            var t = (e === 'Anisocóricas') ? 'Anisocoria OD ' + num(od) + ' / OI ' + num(oi) + ' mm' : e + ' ' + num(od) + ' mm';
            if (hRe.value) t += ', ' + hRe.value.toLowerCase();
            return t;
        }

        function guardar() {
            if (!tocado) return;
            hOD.value = sOD.value; hOI.value = sOI.value;
            var t = resumen();
            q('.ojo-estado').textContent = t;
            q('.ojo-estado').hidden = false;
            if (campoTexto) { campoTexto.value = t; campoTexto.dispatchEvent(new Event('input', { bubbles: true })); }
        }

        function pintarChips() {
            raiz.querySelectorAll('[data-preset]').forEach(function (b) {
                var p = PRESETS[b.dataset.preset];
                b.classList.toggle('activa', tocado && p.od === parseFloat(sOD.value) && p.oi === parseFloat(sOI.value));
            });
            raiz.querySelectorAll('[data-reac]').forEach(function (b) { b.classList.toggle('activa', b.dataset.reac === hRe.value); });
            raiz.classList.toggle('ojo-sin', !tocado);
            q('#ojoValOD').textContent = num(parseFloat(sOD.value)) + ' mm';
            q('#ojoValOI').textContent = num(parseFloat(sOI.value)) + ' mm';
        }

        function poner(od, oi, animado) {
            sOD.value = od; sOI.value = oi; tocado = true;
            if (animado) animar(od, oi, 350); else { visual.od = od; visual.oi = oi; dibujar(); }
            guardar(); pintarChips();
        }

        raiz.querySelectorAll('[data-preset]').forEach(function (b) {
            b.addEventListener('click', function () { var p = PRESETS[b.dataset.preset]; poner(p.od, p.oi, true); });
        });
        [sOD, sOI].forEach(function (s) {
            s.addEventListener('input', function () {
                tocado = true;
                if (anim) { cancelAnimationFrame(anim); anim = null; }
                visual.od = parseFloat(sOD.value); visual.oi = parseFloat(sOI.value); dibujar();
                guardar(); pintarChips();
            });
        });
        raiz.querySelectorAll('[data-reac]').forEach(function (b) {
            b.addEventListener('click', function () {
                hRe.value = hRe.value === b.dataset.reac ? '' : b.dataset.reac;
                if (!tocado) { tocado = true; }
                guardar(); pintarChips();
            });
        });

        // Prueba de luz: muestra cómo respondería cada tipo de reactividad
        q('.ojo-luz').addEventListener('click', function () {
            if (probando) return;
            var od = parseFloat(sOD.value), oi = parseFloat(sOI.value);
            var r = hRe.value || 'Reactivas';
            var destino = r === 'Arreactivas' ? [od, oi] : [Math.min(od, 2), Math.min(oi, 2)];
            if (r === 'Lentas') destino = [Math.min(od, 3.5), Math.min(oi, 3.5)];
            var ms = r === 'Lentas' ? 1300 : 350;
            probando = true; raiz.classList.add('ojo-luz-on');
            animar(destino[0], destino[1], ms, function () {
                setTimeout(function () {
                    animar(od, oi, r === 'Lentas' ? 1300 : 700, function () { probando = false; raiz.classList.remove('ojo-luz-on'); });
                }, 650);
            });
        });

        // Vuelve a pintar tras cargar un borrador o al regresar al formulario
        function repintar() {
            var od = parseFloat(hOD.value), oi = parseFloat(hOI.value);
            if (isFinite(od) && isFinite(oi)) {
                sOD.value = od; sOI.value = oi; tocado = true;
                visual.od = od; visual.oi = oi; dibujar();
                q('.ojo-estado').textContent = resumen(); q('.ojo-estado').hidden = false;
            }
            pintarChips();
        }
        raiz._repintar = repintar;

        visual.od = 4; visual.oi = 4; dibujar(); pintarChips();
    }

    window.OjosPupilas = {
        montar: montar,
        repintar: function () { var r = document.getElementById('ojoPanel'); if (r && r._repintar) r._repintar(); }
    };
})();
