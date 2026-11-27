<?php
// MiniPDF — generador de PDF mínimo, sin dependencias (Helvetica + JPEG).
// Suficiente para reportes con tablas y gráficas de barras.
declare(strict_types=1);

final class MiniPDF
{
    public const W = 595.28; // A4 en puntos
    public const H = 841.89;
    private array $paginas = [];
    private string $actual = '';
    private array $anchos;
    private array $imagenes = [];
    public float $y = 0;
    public float $margen = 40;
    private $alNuevaPagina = null;

    public function __construct()
    {
        $this->anchos = require __DIR__ . '/anchos.php';
    }

    public function alNuevaPagina(callable $f): void { $this->alNuevaPagina = $f; }

    public function pagina(): void
    {
        if ($this->actual !== '') $this->paginas[] = $this->actual;
        $this->actual = ' ';
        $this->y = self::H - $this->margen;
        if ($this->alNuevaPagina) ($this->alNuevaPagina)($this);
    }

    /** Asegura espacio vertical; si no cabe, salta de página. */
    public function espacio(float $alto): void
    {
        if ($this->y - $alto < $this->margen + 20) $this->pagina();
    }

    public static function win(string $s): string
    {
        $r = @iconv('UTF-8', 'Windows-1252//TRANSLIT', $s);
        if ($r === false) $r = mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
        return $r;
    }
    private static function escapar(string $s): string
    {
        return str_replace(['\\', '(', ')', "\r", "\n"], ['\\\\', '\\(', '\\)', '', ' '], $s);
    }
    private static function n(float $v): string { return rtrim(rtrim(number_format($v, 2, '.', ''), '0'), '.'); }
    private static function color(string $hex): array
    {
        $h = ltrim($hex, '#');
        return [hexdec(substr($h, 0, 2)) / 255, hexdec(substr($h, 2, 2)) / 255, hexdec(substr($h, 4, 2)) / 255];
    }

    public function ancho(string $txt, float $tam, bool $negrita = false): float
    {
        $t = self::win($txt);
        $tabla = $this->anchos[$negrita ? 'Helvetica-Bold' : 'Helvetica'];
        $w = 0;
        for ($i = 0, $l = strlen($t); $i < $l; $i++) $w += $tabla[ord($t[$i])] ?: 556;
        return $w * $tam / 1000;
    }

    public function texto(float $x, float $y, string $txt, float $tam = 10, bool $negrita = false, string $color = '#000000', string $alinear = 'L'): void
    {
        if ($alinear === 'R') $x -= $this->ancho($txt, $tam, $negrita);
        elseif ($alinear === 'C') $x -= $this->ancho($txt, $tam, $negrita) / 2;
        [$r, $g, $b] = self::color($color);
        $this->actual .= sprintf("BT /%s %s Tf %s %s %s rg %s %s Td (%s) Tj ET\n",
            $negrita ? 'F2' : 'F1', self::n($tam), self::n($r), self::n($g), self::n($b), self::n($x), self::n($y), self::escapar(self::win($txt)));
    }

    /** Recorta el texto para que quepa en $max puntos (agrega "…"). */
    public function recortar(string $txt, float $tam, float $max, bool $negrita = false): string
    {
        if ($this->ancho($txt, $tam, $negrita) <= $max) return $txt;
        while (mb_strlen($txt) > 1 && $this->ancho($txt . '...', $tam, $negrita) > $max) $txt = mb_substr($txt, 0, -1);
        return rtrim($txt) . '...';
    }

    public function rect(float $x, float $y, float $w, float $h, string $relleno = '#000000', ?string $borde = null): void
    {
        [$r, $g, $b] = self::color($relleno);
        $op = 'f';
        $s = sprintf('%s %s %s rg ', self::n($r), self::n($g), self::n($b));
        if ($borde) { [$r2, $g2, $b2] = self::color($borde); $s .= sprintf('%s %s %s RG 0.5 w ', self::n($r2), self::n($g2), self::n($b2)); $op = 'B'; }
        $this->actual .= $s . sprintf("%s %s %s %s re %s\n", self::n($x), self::n($y), self::n($w), self::n($h), $op);
    }

    public function linea(float $x1, float $y1, float $x2, float $y2, string $color = '#000000', float $grosor = 0.6): void
    {
        [$r, $g, $b] = self::color($color);
        $this->actual .= sprintf("%s %s %s RG %s w %s %s m %s %s l S\n", self::n($r), self::n($g), self::n($b), self::n($grosor), self::n($x1), self::n($y1), self::n($x2), self::n($y2));
    }

    public function jpeg(string $archivo, float $x, float $y, float $alto): float
    {
        if (!is_file($archivo)) return 0;
        $info = @getimagesize($archivo);
        if (!$info) return 0;
        $id = 'I' . (count($this->imagenes) + 1);
        $this->imagenes[$id] = ['datos' => file_get_contents($archivo), 'w' => $info[0], 'h' => $info[1]];
        $ancho = $alto * $info[0] / $info[1];
        $this->actual .= sprintf("q %s 0 0 %s %s %s cm /%s Do Q\n", self::n($ancho), self::n($alto), self::n($x), self::n($y), $id);
        return $ancho;
    }

    public function salida(): string
    {
        if ($this->actual !== '') { $this->paginas[] = $this->actual; $this->actual = ''; }
        $objs = [];
        $objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        $objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        $n = 5;
        $xobj = '';
        foreach ($this->imagenes as $id => $im) {
            $objs[$n] = ['dic' => sprintf('<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>', $im['w'], $im['h'], strlen($im['datos'])), 'stream' => $im['datos']];
            $xobj .= "/$id $n 0 R ";
            $n++;
        }
        $recursos = '<< /Font << /F1 3 0 R /F2 4 0 R >>' . ($xobj ? " /XObject << $xobj>>" : '') . ' >>';
        $kids = [];
        $total = count($this->paginas);
        foreach ($this->paginas as $i => $contenido) {
            // número de página al pie
            $pie = sprintf("BT /F1 7 Tf 0.45 0.45 0.45 rg %s 22 Td (%s) Tj ET\n", self::n(self::W / 2 - 22), self::escapar('Página ' . ($i + 1) . ' de ' . $total));
            $pie = self::win($pie);
            $c = $contenido . $pie;
            $objs[$n] = ['dic' => '<< /Length ' . strlen($c) . ' >>', 'stream' => $c];
            $objs[$n + 1] = sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R >>', self::n(self::W), self::n(self::H), $recursos, $n);
            $kids[] = ($n + 1) . ' 0 R';
            $n += 2;
        }
        $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
        ksort($objs);
        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $off = [];
        foreach ($objs as $num => $o) {
            $off[$num] = strlen($pdf);
            if (is_array($o)) $pdf .= "$num 0 obj\n{$o['dic']}\nstream\n{$o['stream']}\nendstream\nendobj\n";
            else $pdf .= "$num 0 obj\n$o\nendobj\n";
        }
        $xref = strlen($pdf);
        $max = max(array_keys($objs));
        $pdf .= "xref\n0 " . ($max + 1) . "\n0000000000 65535 f \n";
        for ($i = 1; $i <= $max; $i++) $pdf .= sprintf("%010d 00000 n \n", $off[$i] ?? 0);
        $pdf .= "trailer\n<< /Size " . ($max + 1) . " /Root 1 0 R >>\nstartxref\n$xref\n%%EOF";
        return $pdf;
    }
}
