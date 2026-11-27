<?php
declare(strict_types=1);
require __DIR__ . '/config.php';
date_default_timezone_set(ZONA_HORARIA);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

if (strpos(CLAVE_APP, 'CAMBIA') === 0 || strpos(CLAVE_PANEL, 'CAMBIA') === 0 || strlen(CLAVE_APP) < 12 || strlen(CLAVE_PANEL) < 8) {
    http_response_code(503); echo json_encode(['ok' => false, 'error' => 'Falta configurar config.php: cambia CLAVE_APP (mínimo 12 caracteres) y CLAVE_PANEL (mínimo 8).']); exit;
}

function responder(array $d, int $codigo = 200): void { http_response_code($codigo); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function falla(string $m, int $c = 400): void { responder(['ok' => false, 'error' => $m], $c); }

function db(): PDO {
    static $p = null;
    if ($p) return $p;
    $dir = __DIR__ . '/datos';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        @file_put_contents($dir . '/index.html', '');
    }
    // el nombre del archivo depende de tus claves: aunque el servidor no respete el .htaccess, no es adivinable
    $archivo = $dir . '/rastreo_' . substr(hash('sha256', CLAVE_APP . '|' . CLAVE_PANEL), 0, 20) . '.sqlite';
    $p = new PDO('sqlite:' . $archivo, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec('PRAGMA busy_timeout = 5000');
    $p->exec('CREATE TABLE IF NOT EXISTS servicios (
        token TEXT PRIMARY KEY, folio TEXT, unidad TEXT, tipo TEXT, estado TEXT DEFAULT "activo",
        inicio INTEGER, fin INTEGER, lat REAL, lng REAL, acc REAL, vel REAL, rumbo REAL, ult INTEGER, recibido INTEGER)');
    $p->exec('CREATE TABLE IF NOT EXISTS puntos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, lat REAL, lng REAL, acc REAL, vel REAL, rumbo REAL, ts INTEGER)');
    $p->exec('CREATE INDEX IF NOT EXISTS i_puntos ON puntos(token, ts)');
    return $p;
}

function entrada(): array {
    $raw = file_get_contents('php://input', false, null, 0, 200000);
    $j = $raw ? json_decode($raw, true) : null;
    return is_array($j) ? $j : [];
}
function clave_app_ok(array $in): bool {
    $c = (string)($in['clave'] ?? $_GET['clave'] ?? '');
    return $c !== '' && hash_equals(CLAVE_APP, $c);
}
function token_ok($t): bool { return is_string($t) && preg_match('/^[a-f0-9]{24}$/', $t) === 1; }
function num($v, float $min, float $max): ?float { if (!is_numeric($v)) return null; $f = (float)$v; return ($f >= $min && $f <= $max) ? $f : null; }
function texto($v, int $n = 60): string { return mb_substr(trim((string)$v), 0, $n); }

function panel_sesion(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS'])]);
        session_name('steap_panel'); session_start();
    }
}
function panel_ok(): bool {
    // La app (botón "Vista en vivo" del administrador) manda la contraseña del panel en cada consulta.
    global $in;
    if (is_array($in) && isset($in['clave_panel']) && is_string($in['clave_panel'])) {
        if (hash_equals(CLAVE_PANEL, $in['clave_panel'])) return true;
        usleep(600000); return false;
    }
    panel_sesion(); return !empty($_SESSION['panel']);
}

function fila_publica(array $s, int $ahora): array {
    $ult = $s['ult'] ? (int)$s['ult'] : null;
    $estado = $s['estado'];
    if ($estado === 'activo') $estado = ($ult === null) ? 'esperando' : (($ahora - (int)$s['recibido']) > SEGUNDOS_SIN_SENAL ? 'sin_senal' : 'en_ruta');
    return [
        'token' => $s['token'], 'unidad' => $s['unidad'], 'tipo' => $s['tipo'], 'folio' => $s['folio'], 'estado' => $estado,
        'inicio' => (int)$s['inicio'], 'fin' => $s['fin'] ? (int)$s['fin'] : null,
        'lat' => $s['lat'] !== null ? (float)$s['lat'] : null, 'lng' => $s['lng'] !== null ? (float)$s['lng'] : null,
        'acc' => $s['acc'] !== null ? (float)$s['acc'] : null, 'vel' => $s['vel'] !== null ? (float)$s['vel'] : null,
        'rumbo' => $s['rumbo'] !== null ? (float)$s['rumbo'] : null, 'ult' => $ult, 'recibido' => $s['recibido'] ? (int)$s['recibido'] : null,
    ];
}
function ruta(PDO $db, string $token, int $max = 400): array {
    $q = $db->prepare('SELECT lat, lng, ts FROM puntos WHERE token = ? ORDER BY ts ASC, id ASC');
    $q->execute([$token]);
    $todos = $q->fetchAll();
    $n = count($todos);
    if ($n > $max) { $paso = $n / $max; $out = []; for ($i = 0; $i < $max; $i++) $out[] = $todos[(int)floor($i * $paso)]; $out[] = $todos[$n - 1]; $todos = $out; }
    return array_map(fn($p) => [round((float)$p['lat'], 6), round((float)$p['lng'], 6), (int)$p['ts']], $todos);
}

$in = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' ? entrada() : [];
$a = (string)($in['accion'] ?? $_GET['a'] ?? '');
$ahora = time();

try {
    switch ($a) {
        case 'ping':
            if (!clave_app_ok($in)) falla('Clave incorrecta.', 401);
            db();
            responder(['ok' => true, 'hora' => date('c'), 'version' => 1]);

        case 'inicio': {
            if (!clave_app_ok($in)) falla('Clave incorrecta.', 401);
            if (!token_ok($in['token'] ?? null)) falla('Token no válido.');
            $db = db();
            $q = $db->prepare('INSERT OR IGNORE INTO servicios (token, folio, unidad, tipo, estado, inicio) VALUES (?,?,?,?,"activo",?)');
            $q->execute([$in['token'], texto($in['folio'] ?? '', 40), texto($in['unidad'] ?? '', 30), texto($in['tipo'] ?? '', 40), $ahora]);
            if (random_int(1, 20) === 1) { // limpieza de rutas viejas
                $lim = $ahora - DIAS_HISTORIAL * 86400;
                $db->prepare('DELETE FROM puntos WHERE token IN (SELECT token FROM servicios WHERE inicio < ?)')->execute([$lim]);
                $db->prepare('DELETE FROM servicios WHERE inicio < ?')->execute([$lim]);
            }
            responder(['ok' => true]);
        }

        case 'pos': {
            if (!clave_app_ok($in)) falla('Clave incorrecta.', 401);
            if (!token_ok($in['token'] ?? null)) falla('Token no válido.');
            $pts = $in['puntos'] ?? [];
            if (!is_array($pts) || !$pts) falla('Sin puntos.');
            $pts = array_slice($pts, 0, 120);
            $db = db();
            $s = $db->prepare('SELECT token, ult FROM servicios WHERE token = ?'); $s->execute([$in['token']]);
            $srv = $s->fetch();
            if (!$srv) falla('Servicio desconocido.', 404);
            $ins = $db->prepare('INSERT INTO puntos (token, lat, lng, acc, vel, rumbo, ts) VALUES (?,?,?,?,?,?,?)');
            $mejor = null; $guardados = 0;
            $db->beginTransaction();
            foreach ($pts as $p) {
                if (!is_array($p)) continue;
                $lat = num($p['lat'] ?? null, -90, 90); $lng = num($p['lng'] ?? null, -180, 180);
                if ($lat === null || $lng === null) continue;
                $ts = (int)floor(((float)($p['ts'] ?? 0)) / 1000);
                if ($ts < $ahora - 2 * 86400 || $ts > $ahora + 300) $ts = $ahora; // reloj raro: usa la hora del servidor
                $acc = num($p['acc'] ?? null, 0, 100000); $vel = num($p['vel'] ?? null, 0, 200); $rumbo = num($p['rumbo'] ?? null, 0, 360);
                $ins->execute([$in['token'], $lat, $lng, $acc, $vel, $rumbo, $ts]);
                $guardados++;
                if ($mejor === null || $ts >= $mejor['ts']) $mejor = compact('lat', 'lng', 'acc', 'vel', 'rumbo', 'ts');
            }
            if ($mejor && (!$srv['ult'] || $mejor['ts'] >= (int)$srv['ult'])) {
                $db->prepare('UPDATE servicios SET lat=?, lng=?, acc=?, vel=?, rumbo=?, ult=?, recibido=? WHERE token=?')
                   ->execute([$mejor['lat'], $mejor['lng'], $mejor['acc'], $mejor['vel'], $mejor['rumbo'], $mejor['ts'], $ahora, $in['token']]);
            } elseif ($mejor) {
                $db->prepare('UPDATE servicios SET recibido=? WHERE token=?')->execute([$ahora, $in['token']]);
            }
            $db->commit();
            responder(['ok' => true, 'guardados' => $guardados]);
        }

        case 'fin': {
            if (!clave_app_ok($in)) falla('Clave incorrecta.', 401);
            if (!token_ok($in['token'] ?? null)) falla('Token no válido.');
            db()->prepare('UPDATE servicios SET estado="finalizado", fin=? WHERE token=? AND estado="activo"')->execute([$ahora, $in['token']]);
            responder(['ok' => true]);
        }

        case 'estado': { // público: quien tiene el enlace ve esta unidad (el token es largo y no adivinable)
            $t = $_GET['t'] ?? '';
            if (!token_ok($t)) falla('Enlace no válido.', 404);
            $db = db();
            $q = $db->prepare('SELECT * FROM servicios WHERE token = ?'); $q->execute([$t]);
            $s = $q->fetch();
            if (!$s) falla('No encontramos este servicio. Puede que aún no inicie o que ya se haya eliminado.', 404);
            $f = fila_publica($s, $ahora);
            unset($f['token'], $f['folio']);
            responder(['ok' => true, 'ahora' => $ahora, 'servicio' => $f, 'ruta' => ruta($db, $t)]);
        }

        case 'login': {
            if (!isset($in['clave'])) falla('Falta la contraseña.');
            if (!hash_equals(CLAVE_PANEL, (string)$in['clave'])) { usleep(900000); falla('Contraseña incorrecta.', 401); }
            panel_sesion(); session_regenerate_id(true); $_SESSION['panel'] = 1;
            responder(['ok' => true]);
        }
        case 'logout': panel_sesion(); $_SESSION = []; session_destroy(); responder(['ok' => true]);

        case 'activos': {
            if (!panel_ok()) falla(isset($in['clave_panel']) ? 'Contraseña del panel incorrecta.' : 'Sesión no iniciada.', 401);
            $db = db();
            $act = array_map(fn($s) => fila_publica($s, $ahora), $db->query('SELECT * FROM servicios WHERE estado="activo" ORDER BY inicio DESC')->fetchAll());
            $rec = array_map(fn($s) => fila_publica($s, $ahora), $db->query('SELECT * FROM servicios WHERE estado!="activo" ORDER BY fin DESC LIMIT 25')->fetchAll());
            $rutas = [];
            foreach ($act as $s) $rutas[$s['token']] = ruta($db, $s['token'], 150);
            responder(['ok' => true, 'ahora' => $ahora, 'activos' => $act, 'recientes' => $rec, 'rutas' => $rutas]);
        }
        case 'ruta': {
            if (!panel_ok()) falla(isset($in['clave_panel']) ? 'Contraseña del panel incorrecta.' : 'Sesión no iniciada.', 401);
            $t = $in['t'] ?? $_GET['t'] ?? '';
            if (!token_ok($t)) falla('Token no válido.');
            responder(['ok' => true, 'ruta' => ruta(db(), $t, 1500)]);
        }
        default: falla('Acción no reconocida.', 404);
    }
} catch (Throwable $e) {
    error_log('rastreo: ' . $e->getMessage());
    falla('Error del servidor. Revisa que PHP tenga SQLite y que la carpeta "datos" permita escritura.', 500);
}
