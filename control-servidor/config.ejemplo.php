<?php
// ===== CONFIGURACIÓN DEL CONTROL STEAP =====
// Ya viene lista. Solo cámbiala si quieres otro usuario/contraseña de administrador.

// Administrador principal (entra a la app con estos datos y ve el botón "Control").
const ADMIN_USUARIO = '$anleo_admin01';
// Contraseña guardada cifrada (no en texto). Para cambiarla, pide un hash nuevo.
const ADMIN_CLAVE_HASH = 'PON-AQUI-EL-HASH';
// Nombre con el que aparece el administrador en FRAP y reportes (se puede editar desde Control).
const ADMIN_NOMBRE = 'Administrador STEAP';

// Secreto interno (protege la base de datos y el enlace del bot). No lo compartas.
const SECRETO = 'PON-AQUI-UN-SECRETO-LARGO';

const INSTITUCION = 'STEAP Paramédicos';
const ZONA_HORARIA = 'America/Mexico_City';

// Clave de Google Maps para la Vista en vivo (solo se envía a administradores).
const GOOGLE_MAPS_KEY = '';
