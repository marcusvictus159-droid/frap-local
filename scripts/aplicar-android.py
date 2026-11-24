#!/usr/bin/env python3
"""
Se ejecuta después de `npx cap add android`. Personaliza el proyecto Android:
  1. MainActivity con el manejo de barras/teclado.
  2. Permisos de cámara (escanear QR, fotos y video del checklist).
  3. Ícono (corazón con pulso) y nombre.
  4. versionCode / versionName.
Uso: python3 scripts/aplicar-android.py <versionCode> <versionName>
"""
import os, re, shutil, sys

version_code = sys.argv[1] if len(sys.argv) > 1 else "1"
version_name = sys.argv[2] if len(sys.argv) > 2 else "1.0"
APP = "android/app/src/main"
PAQUETE_DIR = f"{APP}/java/com/steap/frap"

# 1) MainActivity
os.makedirs(PAQUETE_DIR, exist_ok=True)
shutil.copyfile("android-overlay/MainActivity.java", f"{PAQUETE_DIR}/MainActivity.java")

# 2) Permisos
ruta = f"{APP}/AndroidManifest.xml"
m = open(ruta, encoding="utf8").read()
extra = ""
for p in ("android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION", "android.permission.POST_NOTIFICATIONS", "android.permission.WAKE_LOCK"):
    if p not in m:
        extra += f'    <uses-permission android:name="{p}" />\n'
for f in ("android.hardware.camera", "android.hardware.camera.autofocus", "android.hardware.location.gps"):
    if f not in m:
        extra += f'    <uses-feature android:name="{f}" android:required="false" />\n'
# Servicio en primer plano del rastreo (Android 14 exige declarar el tipo "location"); se fusiona con el del plugin
if "BackgroundGeolocationService" not in m:
    if "xmlns:tools" not in m:
        m = m.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
    m = m.replace("</application>", '    <service android:name="com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService" android:foregroundServiceType="location" tools:replace="android:foregroundServiceType" />\n    </application>', 1)
if extra:
    m = m.replace("</manifest>", extra + "</manifest>")
open(ruta, "w", encoding="utf8").write(m)

# 3) Ícono: corazón rojo con línea de pulso sobre azul marino (neutral, sirve para cualquier institución)
from PIL import Image, ImageDraw
NAVY = (0, 0, 0, 255)
ROJO = (227, 25, 43, 255)
def icono(tam, fondo, escala):
    img = Image.new('RGBA', (tam, tam), fondo)
    lg = Image.open('assets/steap-logo.png').convert('RGBA')
    w = int(tam * escala); lg = lg.resize((w, round(w * lg.height / lg.width)), Image.LANCZOS)
    img.alpha_composite(lg, ((tam - w) // 2, (tam - lg.height) // 2))
    return img
densidades = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for dens, k in densidades.items():
    carpeta = f"{APP}/res/mipmap-{dens}"
    os.makedirs(carpeta, exist_ok=True)
    lado = int(48 * k)
    icono(lado * 4, NAVY, 0.86).resize((lado, lado), Image.LANCZOS).save(f"{carpeta}/ic_launcher.png")
    redondo = icono(lado * 4, NAVY, 0.72).resize((lado, lado), Image.LANCZOS)
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).ellipse([0, 0, lado - 1, lado - 1], fill=255)
    redondo.putalpha(mascara)
    redondo.save(f"{carpeta}/ic_launcher_round.png")
    fg = int(108 * k)
    icono(fg * 4, (0, 0, 0, 0), 0.58).resize((fg, fg), Image.LANCZOS).save(f"{carpeta}/ic_launcher_foreground.png")
fondo = f"{APP}/res/values/ic_launcher_background.xml"
if os.path.exists(fondo):
    open(fondo, "w", encoding="utf8").write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

# 4) Versión
g = "android/app/build.gradle"
t = open(g, encoding="utf8").read()
t = re.sub(r"versionCode\s+\d+", f"versionCode {version_code}", t)
t = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version_name}"', t)
open(g, "w", encoding="utf8").write(t)
print("Android personalizado: versionCode", version_code, "versionName", version_name)
