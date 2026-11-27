<?php
// Diagnóstico del servidor de control. Bórralo cuando todo funcione.
header('Content-Type: text/plain; charset=utf-8');
ini_set('display_errors', '1'); error_reporting(E_ALL);
echo "PHP: " . PHP_VERSION . "\n";
foreach (['pdo_sqlite', 'mbstring', 'iconv', 'curl', 'json'] as $e) echo $e . ': ' . (extension_loaded($e) ? 'sí' : 'NO') . "\n";
echo "Carpeta escribible: " . (is_writable(__DIR__) ? 'sí' : 'NO') . "\n";
if (version_compare(PHP_VERSION, '7.4.0', '<')) { echo "\nPHP demasiado viejo: cambia a PHP 8.x en hPanel > Avanzado > Configuración de PHP.\n"; exit; }
try {
    require __DIR__ . '/lib/nucleo.php';
    $n = (int)db()->query('SELECT COUNT(*) FROM usuarios')->fetchColumn();
    echo "Base de datos: OK ($n usuario(s))\n";
    echo "PDF de prueba: " . (strlen(pdf_tipos(date('Y-m-01'), date('Y-m-t'))) > 1000 ? 'OK' : 'falló') . "\n";
    echo "\nTodo listo.\n";
} catch (Throwable $e) {
    echo "\nERROR: " . $e->getMessage() . "\nen " . basename($e->getFile()) . ':' . $e->getLine() . "\n";
}
