<?php
// ===== CONFIGURACIÓN DEL RASTREO STEAP =====
// Cambia estas dos claves ANTES de subir a tu hosting (usa letras y números, mínimo 16 caracteres).
// CLAVE_APP   : la lleva la app del teléfono (va dentro del QR de vinculación). Permite enviar ubicaciones.
// CLAVE_PANEL : la contraseña con la que TÚ entras al panel (panel.html).
const CLAVE_APP   = 'CAMBIA-ESTA-CLAVE-APP';
const CLAVE_PANEL = 'CAMBIA-ESTA-CLAVE-PANEL';

// Zona horaria para mostrar horas en el panel.
const ZONA_HORARIA = 'America/Mexico_City';

// Días que se conservan las rutas guardadas.
const DIAS_HISTORIAL = 30;

// Segundos sin recibir ubicación para marcar la unidad como "sin señal".
const SEGUNDOS_SIN_SENAL = 90;
