<?php
// Webhook del bot: Telegram manda aquí los mensajes del grupo y respondemos con reportes PDF.
// Solo atiende al grupo autorizado (el que activó el administrador desde la app).
declare(strict_types=1);
require __DIR__ . '/lib/nucleo.php';
require __DIR__ . '/lib/telegram.php';

header('Content-Type: application/json');
if (!hash_equals(tg_secreto(), (string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) { http_response_code(403); echo '{}'; exit; }

$upd = json_decode((string)file_get_contents('php://input'), true);
$msg = $upd['message'] ?? null;
$bot = ajuste('tg_bot'); $chatOk = ajuste('tg_chat');
if (!$msg || !$bot || !isset($msg['text']) || (string)$msg['chat']['id'] !== (string)$chatOk) { echo '{}'; exit; }

// Respondemos rápido a Telegram y seguimos trabajando (así no reintenta).
echo '{}';
if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
ignore_user_abort(true);
set_time_limit(90);

$chat = $msg['chat']['id'];
$texto = trim((string)$msg['text']);
if ($texto === '' || $texto[0] !== '/') exit;
$partes = preg_split('/\s+/', $texto);
$cmd = strtolower(preg_replace('/@.*$/', '', ltrim(array_shift($partes), '/')));
$responder = fn(string $html) => tg_api($bot, 'sendMessage', ['chat_id' => $chat, 'parse_mode' => 'HTML', 'text' => $html, 'reply_to_message_id' => $msg['message_id']]);
$mandarPdf = fn(string $nombre, string $pdf, string $cap) => tg_api($bot, 'sendDocument', ['chat_id' => $chat, 'caption' => $cap, 'parse_mode' => 'HTML', 'reply_to_message_id' => $msg['message_id']], ['document', $nombre, $pdf]);
$errorFecha = "⚠️ No entendí la fecha. Ejemplos:\n<code>/servicios 26/11/26</code>\n<code>/servicios 01/11/26 15/11/26</code>\n<code>/tipos 11/26</code> (mes)\n<code>/resumen hoy</code> · <code>ayer</code> · <code>semana</code> · <code>mes</code>";

try {
    switch ($cmd) {
        case 'start':
        case 'ayuda':
        case 'help':
            $responder("📋 <b>Comandos de control STEAP</b>\n\n"
                . "<b>/servicios</b> fecha — FRAP y salidas de ese día o rango\n   <code>/servicios 26/11/26</code> · <code>/servicios 01/11/26 15/11/26</code>\n\n"
                . "<b>/tipos</b> periodo — sumatoria de clínicos, traumáticos, gineco y eventos especiales\n   <code>/tipos 11/26</code> · <code>/servicios tipo 11/26</code>\n\n"
                . "<b>/guardias</b> periodo — horas de guardia por persona\n   <code>/guardias 11/26</code>\n\n"
                . "<b>/resumen</b> periodo — reporte completo con gráficas\n   <code>/resumen mes</code>\n\n"
                . "<b>/personal</b> — quién está dado de alta y cuánto lleva este mes\n\n"
                . "Fechas: dd/mm/aa, mm/aa (mes completo), hoy, ayer, semana, mes. Sin fecha: hoy (servicios) o el mes actual.");
            break;

        case 'servicios':
        case 'servicio':
            if (isset($partes[0]) && in_array(mb_strtolower($partes[0]), ['tipo', 'tipos'], true)) {
                array_shift($partes);
                $p = interpretar_periodo($partes, 'mes'); if (!$p) { $responder($errorFecha); break; }
                $e = estadisticas($p[0], $p[1]); $c = $e['por_categoria'];
                $mandarPdf('servicios_por_tipo_' . $p[0] . '.pdf', pdf_tipos($p[0], $p[1]),
                    "📊 <b>Servicios por tipo</b> · " . fmt_periodo($p[0], $p[1]) . "\n🩺 Clínicos: {$c['Clínico']}\n🦴 Traumáticos: {$c['Traumático']}\n🤰 Gineco-obstétricos: {$c['Gineco-Obstétrico']}\n🎪 Eventos especiales: {$c['Evento especial']}\n🏠 Traslados a domicilio: {$c['Traslado a domicilio']}\n<b>Total FRAP: {$e['totales']['fraps']}</b>");
                break;
            }
            $p = interpretar_periodo($partes, 'hoy'); if (!$p) { $responder($errorFecha); break; }
            $e = estadisticas($p[0], $p[1]);
            $mandarPdf('servicios_' . $p[0] . ($p[0] !== $p[1] ? '_al_' . $p[1] : '') . '.pdf', pdf_servicios($p[0], $p[1]),
                "🚑 <b>Servicios</b> · " . fmt_periodo($p[0], $p[1]) . "\nFRAP: <b>{$e['totales']['fraps']}</b> · Salidas: <b>{$e['totales']['salidas']}</b>");
            break;

        case 'tipos':
        case 'tipo':
            $p = interpretar_periodo($partes, 'mes'); if (!$p) { $responder($errorFecha); break; }
            $e = estadisticas($p[0], $p[1]); $c = $e['por_categoria'];
            $mandarPdf('servicios_por_tipo_' . $p[0] . '.pdf', pdf_tipos($p[0], $p[1]),
                "📊 <b>Servicios por tipo</b> · " . fmt_periodo($p[0], $p[1]) . "\n🩺 Clínicos: {$c['Clínico']}\n🦴 Traumáticos: {$c['Traumático']}\n🤰 Gineco-obstétricos: {$c['Gineco-Obstétrico']}\n🎪 Eventos especiales: {$c['Evento especial']}\n🏠 Traslados a domicilio: {$c['Traslado a domicilio']}\n<b>Total FRAP: {$e['totales']['fraps']}</b>");
            break;

        case 'guardias':
        case 'horas':
            $p = interpretar_periodo($partes, 'mes'); if (!$p) { $responder($errorFecha); break; }
            $e = estadisticas($p[0], $p[1]);
            $mandarPdf('guardias_' . $p[0] . '.pdf', pdf_guardias($p[0], $p[1]),
                "⏱ <b>Horas de guardia</b> · " . fmt_periodo($p[0], $p[1]) . "\nTotal: <b>" . fmt_horas($e['totales']['minutos_guardia']) . '</b>');
            break;

        case 'resumen':
        case 'reporte':
            $p = interpretar_periodo($partes, 'mes'); if (!$p) { $responder($errorFecha); break; }
            $e = estadisticas($p[0], $p[1]);
            $mandarPdf('resumen_' . $p[0] . '.pdf', pdf_resumen($p[0], $p[1]),
                "📈 <b>Resumen operativo</b> · " . fmt_periodo($p[0], $p[1]) . "\nFRAP: <b>{$e['totales']['fraps']}</b> · Salidas: <b>{$e['totales']['salidas']}</b> · Guardia: <b>" . fmt_horas($e['totales']['minutos_guardia']) . '</b>');
            break;

        case 'personal':
        case 'usuarios':
            $e = estadisticas(date('Y-m-01'), date('Y-m-t'));
            $t = "👥 <b>Personal activo</b> · " . date('m/Y') . "\n";
            $q = db()->query('SELECT id, nombre, usuario, admin FROM usuarios WHERE activo = 1 ORDER BY nombre');
            foreach ($q->fetchAll() as $u) {
                $g = array_values(array_filter($e['guardias'], fn($x) => $x['id'] === (int)$u['id']))[0] ?? null;
                $f = count(array_filter($e['fraps'], fn($x) => $x['capturo'] === $u['nombre']));
                $t .= "\n• " . htmlspecialchars($u['nombre']) . ($u['admin'] ? ' ⭐' : '') . ($g && $g['en_guardia'] ? ' 🟢' : '')
                    . "\n   FRAP: $f · Guardia: " . fmt_horas($g['minutos'] ?? 0);
            }
            $responder($t . "\n\n🟢 = en guardia ahora · ⭐ = administrador");
            break;

        default:
            $responder('No conozco ese comando. Escribe /ayuda');
    }
} catch (Throwable $ex) {
    error_log('[control-tg] ' . $ex->getMessage());
    $responder('⚠️ No pude generar el reporte: ' . htmlspecialchars($ex->getMessage()));
}
