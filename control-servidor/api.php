<?php
// API del Control STEAP. La app la llama con POST JSON: { accion, token, ... }
declare(strict_types=1);
require __DIR__ . '/lib/nucleo.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function responder(array $d, int $c = 200): void { http_response_code($c); header('Content-Type: application/json; charset=utf-8'); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function falla(string $m, int $c = 400, array $extra = []): void { responder(['ok' => false, 'error' => $m] + $extra, $c); }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') falla('Usa POST.', 405);
$raw = file_get_contents('php://input', false, null, 0, 3000000);
$in = $raw ? json_decode($raw, true) : null;
if (!is_array($in)) falla('Datos no válidos.');
$accion = (string)($in['accion'] ?? '');

try {
    $db = db();

    // ------------------------------------------------------------ login
    if ($accion === 'login') {
        $usuario = txt($in['usuario'] ?? '', 60); $clave = (string)($in['clave'] ?? '');
        // freno simple contra adivinar contraseñas: 8 intentos fallidos por usuario cada 15 min
        $kInt = 'intentos_' . strtolower($usuario);
        $int = json_decode((string)ajuste($kInt), true) ?: ['n' => 0, 't' => 0];
        if ($int['n'] >= 8 && time() - $int['t'] < 900) falla('Demasiados intentos. Espera 15 minutos.', 429);
        $q = $db->prepare('SELECT * FROM usuarios WHERE usuario = ?'); $q->execute([$usuario]);
        $u = $q->fetch();
        if (!$u || !password_verify($clave, (string)$u['hash'])) {
            ajuste($kInt, json_encode(['n' => ($int['n'] >= 8 ? 0 : $int['n']) + 1, 't' => time()]));
            falla('Usuario o contraseña incorrectos.', 401);
        }
        if (!(int)$u['activo']) falla('Este usuario fue dado de baja. Habla con el administrador.', 403);
        ajuste($kInt, json_encode(['n' => 0, 't' => 0]));
        $token = bin2hex(random_bytes(24));
        $db->prepare('INSERT INTO sesiones (token, usuario_id, creado, ult, equipo) VALUES (?,?,?,?,?)')->execute([$token, $u['id'], time(), time(), txt($in['equipo'] ?? '', 80)]);
        responder(['ok' => true, 'token' => $token, 'perfil' => perfil_publico($u)]);
    }

    // A partir de aquí todo requiere sesión
    $yo = usuario_por_token((string)($in['token'] ?? ''));
    if (!$yo) falla('Tu sesión ya no es válida. Vuelve a iniciar sesión.', 401, ['revocado' => true]);

    if ($accion === 'perfil') responder(['ok' => true, 'perfil' => perfil_publico($yo)]);

    if ($accion === 'cerrar_sesion') { $db->prepare('DELETE FROM sesiones WHERE token = ?')->execute([$in['token']]); responder(['ok' => true]); }

    // ------------------------------------------------------------ sincronizar (resumen, sin datos del paciente)
    if ($accion === 'sync') {
        $ahora = time(); $n = ['fraps' => 0, 'servicios' => 0, 'guardias' => 0];
        $db->beginTransaction();
        $qf = $db->prepare('INSERT INTO fraps (folio, usuario_id, jefe, fecha, tipo, categoria, dictamen, hospital, unidad, triage, recibido) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(folio) DO UPDATE SET jefe=excluded.jefe, fecha=excluded.fecha, tipo=excluded.tipo, categoria=excluded.categoria, dictamen=excluded.dictamen,
            hospital=excluded.hospital, unidad=excluded.unidad, triage=excluded.triage, recibido=excluded.recibido WHERE fraps.usuario_id = excluded.usuario_id');
        foreach (array_slice((array)($in['fraps'] ?? []), 0, 3000) as $f) {
            if (!is_array($f) || !($fecha = fecha_ok($f['fecha'] ?? '')) || !preg_match('/^[A-Za-z0-9\-]{4,60}$/', (string)($f['folio'] ?? ''))) continue;
            $tipo = txt($f['tipo'] ?? '', 40);
            $qf->execute([$f['folio'], $yo['id'], txt($f['jefe'] ?? '', 80), $fecha, $tipo, categoria($tipo), txt($f['dictamen'] ?? '', 60),
                txt($f['hospital'] ?? '', 120), txt($f['unidad'] ?? '', 20), txt($f['triage'] ?? '', 20), $ahora]);
            $n['fraps']++;
        }
        $qs = $db->prepare('INSERT INTO servicios (folio, usuario_id, jefe, unidad, tipo, salida, llegada, estado, hospital, recibido) VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(folio) DO UPDATE SET jefe=excluded.jefe, unidad=excluded.unidad, tipo=excluded.tipo, salida=excluded.salida, llegada=excluded.llegada,
            estado=excluded.estado, hospital=excluded.hospital, recibido=excluded.recibido WHERE servicios.usuario_id = excluded.usuario_id');
        foreach (array_slice((array)($in['servicios'] ?? []), 0, 3000) as $s) {
            if (!is_array($s) || !($sal = fecha_ok($s['salida'] ?? '')) || !preg_match('/^[A-Za-z0-9\-]{4,60}$/', (string)($s['folio'] ?? ''))) continue;
            $qs->execute([$s['folio'], $yo['id'], txt($s['jefe'] ?? '', 80), txt($s['unidad'] ?? '', 20), txt($s['tipo'] ?? '', 60), $sal,
                fecha_ok($s['llegada'] ?? ''), txt($s['estado'] ?? '', 12), txt($s['hospital'] ?? '', 120), $ahora]);
            $n['servicios']++;
        }
        $qg = $db->prepare('INSERT INTO guardias (usuario_id, entrada, salida, minutos, base, recibido) VALUES (?,?,?,?,?,?)
            ON CONFLICT(usuario_id, entrada) DO UPDATE SET salida=excluded.salida, minutos=excluded.minutos, base=excluded.base, recibido=excluded.recibido');
        foreach (array_slice((array)($in['guardias'] ?? []), 0, 3000) as $g) {
            if (!is_array($g) || !($ent = fecha_ok($g['entrada'] ?? ''))) continue;
            $sal = fecha_ok($g['salida'] ?? '');
            $min = $sal ? max(0, (int)floor((strtotime($sal) - strtotime($ent)) / 60)) : 0;
            $min = min($min, 72 * 60); // un turno no puede pasar de 72 h
            $qg->execute([$yo['id'], $ent, $sal, $min, txt($g['base'] ?? '', 60), $ahora]);
            $n['guardias']++;
        }
        $db->commit();
        responder(['ok' => true, 'recibidos' => $n, 'perfil' => perfil_publico($yo)]);
    }

    // ------------------------------------------------------------ solo administrador
    if (!(int)$yo['admin']) falla('Solo el administrador puede hacer esto.', 403);

    if ($accion === 'usuarios') {
        $filas = $db->query("SELECT u.id, u.usuario, u.nombre, u.rol, u.admin, u.activo, u.creado,
            (SELECT COUNT(*) FROM fraps f WHERE f.usuario_id = u.id) AS fraps,
            (SELECT COUNT(*) FROM servicios s WHERE s.usuario_id = u.id) AS salidas,
            (SELECT COALESCE(SUM(minutos),0) FROM guardias g WHERE g.usuario_id = u.id AND g.salida IS NOT NULL) AS minutos,
            (SELECT MAX(ult) FROM sesiones x WHERE x.usuario_id = u.id) AS ultima
            FROM usuarios u ORDER BY u.activo DESC, u.admin DESC, u.nombre")->fetchAll();
        foreach ($filas as &$f) foreach (['id', 'admin', 'activo', 'creado', 'fraps', 'salidas', 'minutos', 'ultima'] as $k) $f[$k] = $f[$k] === null ? null : (int)$f[$k];
        responder(['ok' => true, 'usuarios' => $filas]);
    }

    if ($accion === 'usuario_crear') {
        $nombre = preg_replace('/\s+/', ' ', txt($in['nombre'] ?? '', 80));
        if (count(explode(' ', $nombre)) < 2) falla('Escribe el nombre completo (nombre y apellidos).');
        $rol = in_array($in['rol'] ?? '', ['paramedico', 'operador'], true) ? $in['rol'] : 'paramedico';
        $admin = !empty($in['admin']) ? 1 : 0;
        $usuario = generar_usuario($nombre); $clave = generar_clave();
        $db->prepare('INSERT INTO usuarios (usuario, nombre, rol, admin, hash, activo, creado) VALUES (?,?,?,?,?,1,?)')
           ->execute([$usuario, $nombre, $rol, $admin, password_hash($clave, PASSWORD_DEFAULT), time()]);
        responder(['ok' => true, 'usuario' => $usuario, 'clave' => $clave, 'nombre' => $nombre]);
    }

    if (in_array($accion, ['usuario_baja', 'usuario_alta', 'usuario_clave', 'usuario_editar'], true)) {
        $id = (int)($in['id'] ?? 0);
        $q = $db->prepare('SELECT * FROM usuarios WHERE id = ?'); $q->execute([$id]); $u = $q->fetch();
        if (!$u) falla('Ese usuario no existe.', 404);
        if ($accion === 'usuario_baja') {
            if ($u['usuario'] === ADMIN_USUARIO) falla('El administrador principal no se puede dar de baja.');
            $db->prepare('UPDATE usuarios SET activo = 0, baja = ? WHERE id = ?')->execute([time(), $id]);
            $db->prepare('DELETE FROM sesiones WHERE usuario_id = ?')->execute([$id]);
            responder(['ok' => true]);
        }
        if ($accion === 'usuario_alta') { $db->prepare('UPDATE usuarios SET activo = 1, baja = NULL WHERE id = ?')->execute([$id]); responder(['ok' => true]); }
        if ($accion === 'usuario_clave') {
            if ($u['usuario'] === ADMIN_USUARIO) falla('La contraseña del administrador principal se cambia en config.php.');
            $clave = generar_clave();
            $db->prepare('UPDATE usuarios SET hash = ? WHERE id = ?')->execute([password_hash($clave, PASSWORD_DEFAULT), $id]);
            $db->prepare('DELETE FROM sesiones WHERE usuario_id = ?')->execute([$id]);
            responder(['ok' => true, 'usuario' => $u['usuario'], 'clave' => $clave, 'nombre' => $u['nombre']]);
        }
        if ($accion === 'usuario_editar') {
            $nombre = preg_replace('/\s+/', ' ', txt($in['nombre'] ?? $u['nombre'], 80));
            if (count(explode(' ', $nombre)) < 2) falla('Escribe el nombre completo.');
            $rol = in_array($in['rol'] ?? '', ['paramedico', 'operador'], true) ? $in['rol'] : $u['rol'];
            $admin = $u['usuario'] === ADMIN_USUARIO ? 1 : (!empty($in['admin']) ? 1 : 0);
            $db->prepare('UPDATE usuarios SET nombre = ?, rol = ?, admin = ? WHERE id = ?')->execute([$nombre, $rol, $admin, $id]);
            responder(['ok' => true]);
        }
    }

    if ($accion === 'estadisticas') {
        $d1 = (string)($in['desde'] ?? ''); $d2 = (string)($in['hasta'] ?? '');
        $iso = '/^\d{4}-\d{2}-\d{2}$/';
        $p = (preg_match($iso, $d1) && preg_match($iso, $d2)) ? ($d1 <= $d2 ? [$d1, $d2] : [$d2, $d1]) : interpretar_periodo([$d1, $d2], 'mes');
        if (!$p) falla('Fechas no válidas.');
        $e = estadisticas($p[0], $p[1]);
        $e['fraps'] = array_slice(array_reverse($e['fraps']), 0, 400);
        $e['salidas'] = array_slice(array_reverse($e['salidas']), 0, 400);
        $e['telegram'] = ['activo' => (bool)ajuste('tg_activo'), 'chat' => ajuste('tg_chat')];
        responder(['ok' => true] + $e);
    }

    if ($accion === 'reporte') {
        $desde = (string)($in['desde'] ?? date('Y-m-01')); $hasta = (string)($in['hasta'] ?? date('Y-m-t'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $desde) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $hasta)) falla('Fechas no válidas.');
        $tipo = (string)($in['tipo'] ?? 'resumen');
        if ($tipo === 'servicios') $pdf = pdf_servicios($desde, $hasta);
        elseif ($tipo === 'tipos') $pdf = pdf_tipos($desde, $hasta);
        elseif ($tipo === 'guardias') $pdf = pdf_guardias($desde, $hasta);
        else $pdf = pdf_resumen($desde, $hasta);
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="reporte_' . $tipo . '_' . $desde . '.pdf"');
        echo $pdf; exit;
    }

    if ($accion === 'telegram_activar') {
        $bot = trim((string)($in['bot_token'] ?? '')); $chat = trim((string)($in['chat_id'] ?? ''));
        if (!preg_match('/^\d{5,}:[A-Za-z0-9_\-]{20,}$/', $bot)) falla('El token del bot no es válido. Vincula Telegram en Ajustes primero.');
        if (!preg_match('/^-?\d{4,20}$/', $chat)) falla('El ID del grupo no es válido.');
        $esquema = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'https' : 'http';
        $url = $esquema . '://' . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/telegram.php';
        if ($esquema !== 'https') falla('Telegram exige https. Abre el control con https://');
        require_once __DIR__ . '/lib/telegram.php';
        $r = tg_api($bot, 'setWebhook', ['url' => $url, 'secret_token' => tg_secreto(), 'allowed_updates' => json_encode(['message']), 'drop_pending_updates' => 'true']);
        if (empty($r['ok'])) falla('Telegram respondió: ' . ($r['description'] ?? 'sin respuesta'));
        tg_api($bot, 'setMyCommands', ['commands' => json_encode(tg_comandos(), JSON_UNESCAPED_UNICODE)]);
        ajuste('tg_bot', $bot); ajuste('tg_chat', $chat); ajuste('tg_activo', '1');
        tg_api($bot, 'sendMessage', ['chat_id' => $chat, 'parse_mode' => 'HTML', 'text' => "✅ <b>Comandos de control activados</b>\nEscribe /ayuda para ver los reportes disponibles."]);
        responder(['ok' => true, 'webhook' => $url]);
    }

    falla('Acción no reconocida.');
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    error_log('[control] ' . $e->getMessage());
    falla('Error en el servidor: ' . $e->getMessage(), 500);
}
