<?php
// Núcleo del Control STEAP: base de datos, usuarios, estadísticas y reportes PDF.
declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/pdf.php';
date_default_timezone_set(ZONA_HORARIA);

const CATEGORIAS = ['Clínico', 'Traumático', 'Gineco-Obstétrico', 'Evento especial', 'Traslado a domicilio', 'Otro'];
const COLORES = ['#1a6fb5', '#d23b3b', '#b0479a', '#e0b400', '#7a8797', '#2f9e6e', '#e07a1f', '#5b5fc7'];

function db(): PDO
{
    static $p = null;
    if ($p) return $p;
    $dir = __DIR__ . '/../datos';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        @file_put_contents($dir . '/index.html', '');
    }
    $archivo = $dir . '/control_' . substr(hash('sha256', SECRETO), 0, 20) . '.sqlite';
    $p = new PDO('sqlite:' . $archivo, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec('PRAGMA busy_timeout = 5000');
    $p->exec('PRAGMA journal_mode = WAL');
    $p->exec('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT UNIQUE COLLATE NOCASE, nombre TEXT, rol TEXT,
        admin INTEGER DEFAULT 0, hash TEXT, activo INTEGER DEFAULT 1, creado INTEGER, baja INTEGER)');
    $p->exec('CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, usuario_id INTEGER, creado INTEGER, ult INTEGER, equipo TEXT)');
    $p->exec('CREATE TABLE IF NOT EXISTS fraps (folio TEXT PRIMARY KEY, usuario_id INTEGER, jefe TEXT, fecha TEXT, tipo TEXT, categoria TEXT,
        dictamen TEXT, hospital TEXT, unidad TEXT, triage TEXT, recibido INTEGER)');
    $p->exec('CREATE TABLE IF NOT EXISTS servicios (folio TEXT PRIMARY KEY, usuario_id INTEGER, jefe TEXT, unidad TEXT, tipo TEXT,
        salida TEXT, llegada TEXT, estado TEXT, hospital TEXT, recibido INTEGER)');
    $p->exec('CREATE TABLE IF NOT EXISTS guardias (usuario_id INTEGER, entrada TEXT, salida TEXT, minutos INTEGER, base TEXT, recibido INTEGER,
        PRIMARY KEY (usuario_id, entrada))');
    $p->exec('CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT)');
    $p->exec('CREATE INDEX IF NOT EXISTS i_fraps_fecha ON fraps(fecha)');
    $p->exec('CREATE INDEX IF NOT EXISTS i_serv_fecha ON servicios(salida)');
    // Administrador principal (de config.php)
    $q = $p->prepare('SELECT id FROM usuarios WHERE usuario = ?');
    $q->execute([ADMIN_USUARIO]);
    if (!$q->fetch()) {
        $p->prepare('INSERT INTO usuarios (usuario, nombre, rol, admin, hash, activo, creado) VALUES (?,?,?,?,?,1,?)')
          ->execute([ADMIN_USUARIO, ADMIN_NOMBRE, 'paramedico', 1, ADMIN_CLAVE_HASH, time()]);
    }
    return $p;
}

function ajuste(string $k, ?string $v = null): ?string
{
    if ($v !== null) { db()->prepare('INSERT INTO ajustes (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')->execute([$k, $v]); return $v; }
    $q = db()->prepare('SELECT valor FROM ajustes WHERE clave = ?'); $q->execute([$k]);
    $r = $q->fetch(); return $r ? $r['valor'] : null;
}

function txt($v, int $n = 120): string { return mb_substr(trim((string)$v), 0, $n); }

function contiene(string $h, string $n): bool { return $n === '' || strpos($h, $n) !== false; }

function categoria(string $tipo): string
{
    $t = mb_strtolower($tipo);
    if (contiene($t, 'domicilio')) return 'Traslado a domicilio';
    if (contiene($t, 'trauma')) return 'Traumático';
    if (contiene($t, 'gineco') || contiene($t, 'obst')) return 'Gineco-Obstétrico';
    if (contiene($t, 'evento')) return 'Evento especial';
    if (contiene($t, 'enfermedad') || contiene($t, 'clín') || contiene($t, 'clin')) return 'Clínico';
    return $t === '' ? 'Otro' : 'Otro';
}

function fecha_ok($s): ?string
{
    $s = (string)$s;
    return preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $s) ? (strlen($s) === 16 ? $s . ':00' : $s) : null;
}

// ---------------------------------------------------------------- usuarios
function sin_acentos(string $s): string
{
    $s = strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u', 'Ü' => 'u', 'Ñ' => 'n']);
    return strtolower(preg_replace('/[^A-Za-z ]/', '', $s));
}
function generar_usuario(string $nombre): string
{
    $partes = array_values(array_filter(explode(' ', sin_acentos($nombre)), fn($w) => $w !== '' && !in_array($w, ['de', 'del', 'la', 'las', 'los', 'y'], true)));
    $base = ($partes[0][0] ?? 'u') . ($partes[1] ?? ($partes[0] ?? 'usuario'));
    $base = substr($base, 0, 14);
    $q = db()->prepare('SELECT 1 FROM usuarios WHERE usuario = ?');
    for ($i = 1; $i < 1000; $i++) {
        $u = $base . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
        $q->execute([$u]);
        if (!$q->fetch()) return $u;
    }
    return $base . bin2hex(random_bytes(3));
}
function generar_clave(): string
{
    $abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $s = '';
    for ($i = 0; $i < 8; $i++) $s .= $abc[random_int(0, strlen($abc) - 1)];
    return substr($s, 0, 4) . '-' . substr($s, 4);
}
function usuario_por_token(string $t): ?array
{
    if (!preg_match('/^[a-f0-9]{48}$/', $t)) return null;
    $q = db()->prepare('SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND u.activo = 1');
    $q->execute([$t]);
    $u = $q->fetch();
    if ($u) db()->prepare('UPDATE sesiones SET ult = ? WHERE token = ?')->execute([time(), $t]);
    return $u ?: null;
}
function perfil_publico(array $u): array
{
    return ['id' => (int)$u['id'], 'usuario' => $u['usuario'], 'nombre' => $u['nombre'], 'rol' => $u['rol'], 'admin' => (bool)$u['admin']];
}

// ---------------------------------------------------------------- fechas
/** Interpreta textos como 26/11/26, 26/11/2026, 11/26, 11/2026, hoy, ayer, semana, mes. Devuelve [desde, hasta] (Y-m-d). */
function interpretar_periodo(array $palabras, string $defecto = 'hoy'): ?array
{
    $fechas = [];
    foreach ($palabras as $p) {
        $p = mb_strtolower(trim($p));
        if ($p === '') continue;
        if ($p === 'hoy') { $d = date('Y-m-d'); $fechas[] = [$d, $d]; continue; }
        if ($p === 'ayer') { $d = date('Y-m-d', strtotime('-1 day')); $fechas[] = [$d, $d]; continue; }
        if ($p === 'semana') { $fechas[] = [date('Y-m-d', strtotime('-6 days')), date('Y-m-d')]; continue; }
        if ($p === 'mes') { $fechas[] = [date('Y-m-01'), date('Y-m-t')]; continue; }
        if (preg_match('#^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$#', $p, $m)) {
            $a = (int)$m[3]; if ($a < 100) $a += 2000;
            if (!checkdate((int)$m[2], (int)$m[1], $a)) return null;
            $d = sprintf('%04d-%02d-%02d', $a, $m[2], $m[1]); $fechas[] = [$d, $d]; continue;
        }
        if (preg_match('#^(\d{1,2})[/\-.](\d{2}|\d{4})$#', $p, $m)) {
            $a = (int)$m[2]; if ($a < 100) $a += 2000;
            $mes = (int)$m[1]; if ($mes < 1 || $mes > 12) return null;
            $ini = sprintf('%04d-%02d-01', $a, $mes); $fechas[] = [$ini, date('Y-m-t', strtotime($ini))]; continue;
        }
        return null;
    }
    if (!$fechas) return interpretar_periodo([$defecto]);
    if (count($fechas) === 1) return $fechas[0];
    $a = $fechas[0][0]; $b = $fechas[count($fechas) - 1][1];
    return $a <= $b ? [$a, $b] : [$b, $a];
}
function fmt_fecha(string $ymd): string { $t = strtotime($ymd); return $t ? date('d/m/Y', $t) : $ymd; }
function fmt_periodo(string $a, string $b): string { return $a === $b ? fmt_fecha($a) : fmt_fecha($a) . ' al ' . fmt_fecha($b); }
function fmt_horas(int $min): string { return intdiv($min, 60) . 'h ' . str_pad((string)($min % 60), 2, '0', STR_PAD_LEFT) . 'm'; }

// ---------------------------------------------------------------- estadísticas
function estadisticas(string $desde, string $hasta): array
{
    $db = db();
    $ini = $desde . ' 00:00:00'; $fin = $hasta . ' 23:59:59';
    $nombre = "COALESCE(NULLIF(f.jefe,''), u.nombre, 'Sin nombre')";

    $q = $db->prepare("SELECT f.folio, f.fecha, $nombre AS jefe, f.tipo, f.categoria, f.dictamen, f.unidad, f.triage, f.hospital, u.nombre AS capturo
        FROM fraps f LEFT JOIN usuarios u ON u.id = f.usuario_id WHERE f.fecha BETWEEN ? AND ? ORDER BY f.fecha ASC");
    $q->execute([$ini, $fin]);
    $fraps = $q->fetchAll();

    $porCat = array_fill_keys(CATEGORIAS, 0); $porDict = []; $porUnidad = []; $porJefe = []; $porDia = []; $porTriage = [];
    foreach ($fraps as $f) {
        $porCat[$f['categoria'] ?: 'Otro'] = ($porCat[$f['categoria'] ?: 'Otro'] ?? 0) + 1;
        $d = $f['dictamen'] ?: 'Sin dictamen'; $porDict[$d] = ($porDict[$d] ?? 0) + 1;
        $un = $f['unidad'] ?: 'Sin unidad'; $porUnidad[$un] = ($porUnidad[$un] ?? 0) + 1;
        $porJefe[$f['jefe']] = ($porJefe[$f['jefe']] ?? 0) + 1;
        $dia = substr($f['fecha'], 0, 10); $porDia[$dia] = ($porDia[$dia] ?? 0) + 1;
        $tr = $f['triage'] ?: 'Sin triage'; $porTriage[$tr] = ($porTriage[$tr] ?? 0) + 1;
    }
    arsort($porDict); arsort($porUnidad); arsort($porJefe); ksort($porDia);

    $q = $db->prepare("SELECT s.folio, s.salida, s.llegada, s.unidad, s.tipo, s.estado, s.hospital, COALESCE(NULLIF(s.jefe,''), u.nombre) AS jefe
        FROM servicios s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE s.salida BETWEEN ? AND ? ORDER BY s.salida ASC");
    $q->execute([$ini, $fin]);
    $salidas = $q->fetchAll();
    $salidasTipo = [];
    foreach ($salidas as $s) { $t = $s['tipo'] ?: 'Sin tipo'; $salidasTipo[$t] = ($salidasTipo[$t] ?? 0) + 1; }
    arsort($salidasTipo);

    // Horas de guardia por persona (turnos que empezaron en el periodo)
    $q = $db->prepare("SELECT u.id, u.nombre, u.usuario, u.activo, COUNT(g.entrada) AS turnos,
        COALESCE(SUM(CASE WHEN g.salida IS NOT NULL THEN g.minutos ELSE 0 END),0) AS minutos,
        MAX(CASE WHEN g.entrada IS NOT NULL AND g.salida IS NULL THEN 1 ELSE 0 END) AS en_guardia
        FROM usuarios u LEFT JOIN guardias g ON g.usuario_id = u.id AND g.entrada BETWEEN ? AND ?
        GROUP BY u.id ORDER BY minutos DESC, u.nombre");
    $q->execute([$ini, $fin]);
    $guardias = [];
    foreach ($q->fetchAll() as $g) {
        if (!$g['activo'] && !$g['turnos']) continue;
        $guardias[] = ['id' => (int)$g['id'], 'nombre' => $g['nombre'], 'usuario' => $g['usuario'], 'turnos' => (int)$g['turnos'],
            'minutos' => (int)$g['minutos'], 'en_guardia' => (bool)$g['en_guardia']];
    }
    $minTotal = array_sum(array_column($guardias, 'minutos'));

    // Por persona: FRAP + salidas + horas
    $porPersona = [];
    foreach ($guardias as $g) $porPersona[$g['nombre']] = ['fraps' => 0, 'salidas' => 0, 'minutos' => $g['minutos'], 'folios' => []];
    foreach ($fraps as $f) {
        $k = $f['capturo'] ?: $f['jefe'];
        $porPersona[$k] ??= ['fraps' => 0, 'salidas' => 0, 'minutos' => 0, 'folios' => []];
        $porPersona[$k]['fraps']++; $porPersona[$k]['folios'][] = $f['folio'];
    }
    foreach ($salidas as $s) {
        $k = $s['jefe'] ?: 'Sin nombre';
        $porPersona[$k] ??= ['fraps' => 0, 'salidas' => 0, 'minutos' => 0, 'folios' => []];
        $porPersona[$k]['salidas']++;
    }
    uasort($porPersona, fn($a, $b) => ($b['fraps'] <=> $a['fraps']) ?: ($b['minutos'] <=> $a['minutos']));

    $activos = (int)$db->query('SELECT COUNT(*) FROM usuarios WHERE activo = 1')->fetchColumn();
    return [
        'desde' => $desde, 'hasta' => $hasta,
        'totales' => ['fraps' => count($fraps), 'salidas' => count($salidas), 'minutos_guardia' => $minTotal, 'usuarios_activos' => $activos],
        'por_categoria' => $porCat, 'por_dictamen' => $porDict, 'por_unidad' => $porUnidad, 'por_jefe' => $porJefe,
        'por_dia' => $porDia, 'por_triage' => $porTriage, 'salidas_por_tipo' => $salidasTipo,
        'guardias' => $guardias, 'por_persona' => $porPersona,
        'fraps' => $fraps, 'salidas' => $salidas,
    ];
}

// ---------------------------------------------------------------- reportes PDF
final class Reporte
{
    public MiniPDF $p;
    private float $x0; private float $ancho;
    public function __construct(string $titulo, string $periodo)
    {
        $this->p = new MiniPDF();
        $this->x0 = $this->p->margen; $this->ancho = MiniPDF::W - 2 * $this->p->margen;
        $logo = __DIR__ . '/logo.jpg';
        $this->p->alNuevaPagina(function (MiniPDF $p) use ($titulo, $periodo, $logo) {
            $top = MiniPDF::H - 34;
            $p->jpeg($logo, $this->x0, $top - 34, 34);
            $p->texto($this->x0 + $this->ancho, $top - 10, mb_strtoupper($titulo), 13, true, '#14599a', 'R');
            $p->texto($this->x0 + $this->ancho, $top - 24, 'Periodo: ' . $periodo, 8.5, false, '#333333', 'R');
            $p->texto($this->x0 + $this->ancho, $top - 34, 'Generado: ' . date('d/m/Y H:i') . ' · ' . INSTITUCION, 7, false, '#777777', 'R');
            $p->rect($this->x0, $top - 44, $this->ancho, 2.2, '#14599a');
            $p->rect($this->x0, $top - 46.5, $this->ancho, 1.4, '#f2dc00');
            $p->y = $top - 64;
        });
        $this->p->pagina();
    }
    public function seccion(string $t): void
    {
        $p = $this->p; $p->y -= 8; $p->espacio(80);
        $p->rect($this->x0, $p->y - 17, $this->ancho, 17, '#0b1d33');
        $p->texto($this->x0 + 8, $p->y - 12, mb_strtoupper($t), 9.5, true, '#ffffff');
        $p->y -= 26;
    }
    public function tarjetas(array $pares): void
    {
        $p = $this->p; $p->espacio(54);
        $n = count($pares); $g = 8; $w = ($this->ancho - $g * ($n - 1)) / $n; $i = 0;
        foreach ($pares as $etq => $val) {
            $x = $this->x0 + $i * ($w + $g);
            $p->rect($x, $p->y - 40, $w, 44, '#eef4fb', '#c9daee');
            $p->texto($x + $w / 2, $p->y - 16, (string)$val, 17, true, '#14599a', 'C');
            $p->texto($x + $w / 2, $p->y - 32, $etq, 7.5, false, '#444444', 'C');
            $i++;
        }
        $p->y -= 56;
    }
    /** Gráfica de barras horizontales. $datos = [etiqueta => número] */
    public function barras(array $datos, string $sufijo = '', ?callable $fmt = null): void
    {
        $p = $this->p;
        if (!$datos || max($datos) <= 0) { $p->espacio(16); $p->texto($this->x0, $p->y, 'Sin datos en este periodo.', 9, false, '#777777'); $p->y -= 18; return; }
        $max = max($datos); $etqW = 150; $barW = $this->ancho - $etqW - 70; $i = 0; $total = array_sum($datos);
        foreach ($datos as $etq => $v) {
            $p->espacio(18);
            $p->texto($this->x0, $p->y - 9, $p->recortar((string)$etq, 8.5, $etqW - 8), 8.5, false, '#222222');
            $w = $max > 0 ? max(1.5, $barW * $v / $max) : 0;
            $p->rect($this->x0 + $etqW, $p->y - 12, $barW, 12, '#f1f3f6');
            if ($v > 0) $p->rect($this->x0 + $etqW, $p->y - 12, $w, 12, COLORES[$i % count(COLORES)]);
            $valor = $fmt ? $fmt($v) : ($v . $sufijo . ($total > 0 && !$sufijo ? '  (' . round($v * 100 / $total) . '%)' : ''));
            $p->texto($this->x0 + $etqW + $barW + 6, $p->y - 9.5, $valor, 8, true, '#222222');
            $p->y -= 17; $i++;
        }
        $p->y -= 6;
    }
    /** Tabla con encabezado. $cols = [[titulo, ancho_relativo, alinear]] */
    public function tabla(array $cols, array $filas, ?array $totales = null): void
    {
        $p = $this->p; $suma = array_sum(array_column($cols, 1)); $anchos = [];
        foreach ($cols as $c) $anchos[] = $this->ancho * $c[1] / $suma;
        $enc = function () use ($p, $cols, $anchos) {
            $p->espacio(36);
            $p->rect($this->x0, $p->y - 13, $this->ancho, 15, '#14599a');
            $x = $this->x0;
            foreach ($cols as $i => $c) {
                $al = $c[2] ?? 'L';
                $tx = $al === 'R' ? $x + $anchos[$i] - 4 : ($al === 'C' ? $x + $anchos[$i] / 2 : $x + 4);
                $p->texto($tx, $p->y - 9, $c[0], 7.8, true, '#ffffff', $al);
                $x += $anchos[$i];
            }
            $p->y -= 15;
        };
        $enc();
        if (!$filas) { $p->texto($this->x0 + 4, $p->y - 11, 'Sin registros en este periodo.', 8.5, false, '#777777'); $p->y -= 20; return; }
        $filas = $totales ? array_merge($filas, [['__total' => true] + $totales]) : $filas;
        foreach ($filas as $n => $f) {
            if ($p->y - 14 < $p->margen + 20) { $p->pagina(); $enc(); }
            $esTotal = isset($f['__total']); unset($f['__total']);
            if ($esTotal) $p->rect($this->x0, $p->y - 13, $this->ancho, 14, '#fff6bf');
            elseif ($n % 2) $p->rect($this->x0, $p->y - 13, $this->ancho, 14, '#f4f7fb');
            $x = $this->x0; $vals = array_values($f);
            foreach ($cols as $i => $c) {
                $al = $c[2] ?? 'L'; $v = (string)($vals[$i] ?? '');
                $v = $p->recortar($v, 7.8, $anchos[$i] - 8, $esTotal);
                $tx = $al === 'R' ? $x + $anchos[$i] - 4 : ($al === 'C' ? $x + $anchos[$i] / 2 : $x + 4);
                $p->texto($tx, $p->y - 9.5, $v, 7.8, $esTotal, '#1b1b1b', $al);
                $x += $anchos[$i];
            }
            $p->y -= 14;
        }
        $p->y -= 8;
    }
    public function nota(string $t): void { $this->p->espacio(14); $this->p->texto($this->x0, $this->p->y, $t, 7.5, false, '#666666'); $this->p->y -= 14; }
    public function pdf(): string { return $this->p->salida(); }
}

function corta(string $fecha): string { $t = strtotime($fecha); return $t ? date('d/m/y H:i', $t) : $fecha; }

function pdf_servicios(string $desde, string $hasta): string
{
    $e = estadisticas($desde, $hasta);
    $r = new Reporte('Reporte de servicios', fmt_periodo($desde, $hasta));
    $r->tarjetas(['FRAP registradas' => $e['totales']['fraps'], 'Salidas de unidad' => $e['totales']['salidas'],
        'Traumáticos' => $e['por_categoria']['Traumático'], 'Clínicos' => $e['por_categoria']['Clínico']]);
    $r->seccion('FRAP del periodo');
    $r->tabla([['Folio', 2.3], ['Fecha', 1.3], ['Jefe de servicio', 2.3], ['Tipo', 1.4], ['Dictamen', 2], ['Unidad', 0.8, 'C']],
        array_map(fn($f) => [$f['folio'], corta($f['fecha']), $f['jefe'], $f['categoria'], $f['dictamen'], $f['unidad']], $e['fraps']));
    $r->seccion('Salidas de unidad');
    $r->tabla([['Folio', 2.2], ['Salida', 1.3], ['Llegada', 1.3], ['Unidad', 0.8, 'C'], ['Tipo', 1.6], ['Jefe', 2]],
        array_map(fn($s) => [$s['folio'], corta($s['salida']), $s['llegada'] ? corta($s['llegada']) : 'En curso', $s['unidad'], $s['tipo'], $s['jefe']], $e['salidas']));
    $r->nota('Los datos del paciente no se guardan en el servidor; consúltalos en el PDF de cada FRAP en Telegram.');
    return $r->pdf();
}

function pdf_tipos(string $desde, string $hasta): string
{
    $e = estadisticas($desde, $hasta);
    $r = new Reporte('Servicios por tipo', fmt_periodo($desde, $hasta));
    $c = $e['por_categoria'];
    $r->tarjetas(['Total FRAP' => $e['totales']['fraps'], 'Clínicos' => $c['Clínico'], 'Traumáticos' => $c['Traumático'],
        'Gineco-Obst.' => $c['Gineco-Obstétrico'], 'Eventos esp.' => $c['Evento especial'], 'A domicilio' => $c['Traslado a domicilio']]);
    $r->seccion('Sumatoria por tipo de servicio');
    $sin = array_filter($c, fn($v, $k) => $k !== 'Otro' || $v > 0, ARRAY_FILTER_USE_BOTH);
    $r->barras($sin);
    $r->tabla([['Tipo de servicio', 4], ['Cantidad', 1, 'R'], ['Porcentaje', 1, 'R']],
        array_map(fn($k, $v) => [$k, $v, $e['totales']['fraps'] ? round($v * 100 / $e['totales']['fraps'], 1) . '%' : '0%'], array_keys($sin), $sin),
        ['TOTAL', $e['totales']['fraps'], '100%']);
    $r->seccion('Salidas de unidad por tipo');
    $r->barras($e['salidas_por_tipo']);
    $r->seccion('Dictamen final');
    $r->barras($e['por_dictamen']);
    return $r->pdf();
}

function pdf_guardias(string $desde, string $hasta): string
{
    $e = estadisticas($desde, $hasta);
    $r = new Reporte('Horas de guardia', fmt_periodo($desde, $hasta));
    $r->tarjetas(['Horas totales' => fmt_horas($e['totales']['minutos_guardia']), 'Personal activo' => $e['totales']['usuarios_activos'],
        'Turnos' => array_sum(array_column($e['guardias'], 'turnos'))]);
    $r->seccion('Horas por persona');
    $datos = [];
    foreach ($e['guardias'] as $g) $datos[$g['nombre']] = $g['minutos'];
    $r->barras($datos, '', fn($m) => fmt_horas((int)$m));
    $r->tabla([['Nombre', 3.2], ['Usuario', 1.6], ['Turnos', 0.8, 'R'], ['Horas', 1.1, 'R'], ['Estado', 1.2, 'C']],
        array_map(fn($g) => [$g['nombre'], $g['usuario'], $g['turnos'], fmt_horas($g['minutos']), $g['en_guardia'] ? 'En guardia' : ''], $e['guardias']),
        ['TOTAL', '', array_sum(array_column($e['guardias'], 'turnos')), fmt_horas($e['totales']['minutos_guardia']), '']);
    $r->nota('Se cuentan los turnos que iniciaron dentro del periodo y ya tienen salida registrada.');
    return $r->pdf();
}

function pdf_resumen(string $desde, string $hasta): string
{
    $e = estadisticas($desde, $hasta);
    $r = new Reporte('Resumen operativo', fmt_periodo($desde, $hasta));
    $r->tarjetas(['FRAP' => $e['totales']['fraps'], 'Salidas' => $e['totales']['salidas'],
        'Horas de guardia' => fmt_horas($e['totales']['minutos_guardia']), 'Personal activo' => $e['totales']['usuarios_activos']]);
    $r->seccion('Servicios por tipo');
    $r->barras(array_filter($e['por_categoria'], fn($v, $k) => $k !== 'Otro' || $v > 0, ARRAY_FILTER_USE_BOTH));
    $r->seccion('Servicios por día');
    $dias = [];
    foreach ($e['por_dia'] as $d => $n) $dias[fmt_fecha($d)] = $n;
    $r->barras($dias, ' FRAP');
    $r->seccion('Por unidad');
    $r->barras($e['por_unidad']);
    $r->seccion('Desempeño por persona');
    $filas = [];
    foreach ($e['por_persona'] as $n => $d) $filas[] = [$n, $d['fraps'], $d['salidas'], fmt_horas($d['minutos']), implode(', ', array_slice($d['folios'], 0, 3)) . (count($d['folios']) > 3 ? '…' : '')];
    $r->tabla([['Nombre', 2.6], ['FRAP', 0.7, 'R'], ['Salidas', 0.8, 'R'], ['Horas', 1, 'R'], ['Folios', 3.2]], $filas);
    $r->seccion('Dictamen final');
    $r->barras($e['por_dictamen']);
    return $r->pdf();
}
