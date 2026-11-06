// Copia las librerías (Bootstrap, iconos, QR, firma, PDF) desde node_modules a
// www/vendor para que la app funcione SIN internet. Se ejecuta en el flujo de
// GitHub (y a mano con: npm install && npm run vendor).
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';

const destino = 'www/vendor';
mkdirSync(destino, { recursive: true });

const archivos = [
  ['node_modules/bootstrap/dist/css/bootstrap.min.css', 'bootstrap.min.css'],
  ['node_modules/bootstrap/dist/js/bootstrap.bundle.min.js', 'bootstrap.bundle.min.js'],
  ['node_modules/bootstrap-icons/font/bootstrap-icons.css', 'bootstrap-icons.css'],
  ['node_modules/html5-qrcode/html5-qrcode.min.js', 'html5-qrcode.min.js'],
  ['node_modules/signature_pad/dist/signature_pad.umd.min.js', 'signature_pad.umd.min.js'],
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
];
for (const [origen, nombre] of archivos) {
  if (!existsSync(origen)) { console.error('FALTA ' + origen); process.exit(1); }
  copyFileSync(origen, `${destino}/${nombre}`);
}
// Las fuentes de los iconos van en vendor/fonts (el CSS las pide ahí).
if (!existsSync('node_modules/bootstrap-icons/font/fonts')) { console.error('FALTAN las fuentes de bootstrap-icons'); process.exit(1); }
cpSync('node_modules/bootstrap-icons/font/fonts', `${destino}/fonts`, { recursive: true });
// Leaflet (mapa) y la tipografía condensada del tema.
const leaf = 'node_modules/leaflet/dist';
if (!existsSync(leaf + '/leaflet.js')) { console.error('FALTA leaflet'); process.exit(1); }
mkdirSync(`${destino}/leaflet`, { recursive: true });
copyFileSync(leaf + '/leaflet.js', `${destino}/leaflet/leaflet.js`);
copyFileSync(leaf + '/leaflet.css', `${destino}/leaflet/leaflet.css`);
cpSync(leaf + '/images', `${destino}/leaflet/images`, { recursive: true });
for (const peso of [600, 700, 800]) {
  const f = `barlow-condensed-latin-${peso}-normal.woff2`;
  const o = `node_modules/@fontsource/barlow-condensed/files/${f}`;
  if (!existsSync(o)) { console.error('FALTA ' + o); process.exit(1); }
  copyFileSync(o, `${destino}/fonts/${f}`);
}
console.log('vendor listo en', destino);
