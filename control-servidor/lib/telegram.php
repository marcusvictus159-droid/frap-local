<?php
// Utilidades para hablar con la API de Telegram desde el servidor.
declare(strict_types=1);

function tg_secreto(): string { return substr(hash('sha256', SECRETO . '|telegram'), 0, 40); }

function tg_comandos(): array
{
    return [
        ['command' => 'servicios', 'description' => 'Servicios de una fecha: /servicios 26/11/26 (o rango, hoy, ayer, semana, mes)'],
        ['command' => 'tipos', 'description' => 'Sumatoria por tipo: /tipos 11/26 (clínicos, traumáticos, eventos…)'],
        ['command' => 'guardias', 'description' => 'Horas de guardia por persona: /guardias 11/26'],
        ['command' => 'resumen', 'description' => 'Reporte completo con gráficas: /resumen 11/26'],
        ['command' => 'personal', 'description' => 'Lista del personal y lo que lleva este mes'],
        ['command' => 'ayuda', 'description' => 'Ver todos los comandos'],
    ];
}

/** Llama a un método de la API. $archivo = [campo, nombre, bytes] para mandar documentos. */
function tg_api(string $bot, string $metodo, array $params = [], ?array $archivo = null): array
{
    $url = (defined('TG_API_BASE') ? TG_API_BASE : 'https://api.telegram.org') . '/bot' . $bot . '/' . $metodo;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($archivo) {
            $tmp = tempnam(sys_get_temp_dir(), 'tg');
            file_put_contents($tmp, $archivo[2]);
            $params[$archivo[0]] = new CURLFile($tmp, 'application/pdf', $archivo[1]);
        }
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $params, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 10]);
        $r = curl_exec($ch);
        curl_close($ch);
        if (isset($tmp)) @unlink($tmp);
    } else {
        $limite = '----steap' . bin2hex(random_bytes(8));
        $cuerpo = '';
        foreach ($params as $k => $v) $cuerpo .= "--$limite\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
        if ($archivo) $cuerpo .= "--$limite\r\nContent-Disposition: form-data; name=\"{$archivo[0]}\"; filename=\"{$archivo[1]}\"\r\nContent-Type: application/pdf\r\n\r\n{$archivo[2]}\r\n";
        $cuerpo .= "--$limite--\r\n";
        $r = @file_get_contents($url, false, stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: multipart/form-data; boundary=$limite", 'content' => $cuerpo, 'timeout' => 40, 'ignore_errors' => true]]));
    }
    $j = $r ? json_decode($r, true) : null;
    return is_array($j) ? $j : ['ok' => false, 'description' => 'Sin respuesta de Telegram'];
}
