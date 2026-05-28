// Configuración de permisos por vista y rol de usuario
const PERMISOS_VISTAS = {
  "inicio": [0, 1, 2, 3, 4, 5, 6],
  "menudecambios": [1, 2, 3, 4, 5, 6],
  "cambiodefranco": [1, 2, 3, 4, 5, 6],
  "cambiodehorario": [1, 2, 3, 4, 5, 6],
  "programacioncompleta": [0, 1, 2, 3, 4, 5, 6],
  "guardiaonline": [1, 2, 3, 4, 5, 6],
  "historialcambios": [1, 2, 3, 4, 5, 6],
  "contactolideres": [1, 2, 3, 4, 5, 6],
  "nomina": [0, 1, 2, 3, 4, 5, 6],
  "metricas": [0, 1, 2, 3, 4, 5, 6],
  "cargarprogramacion": [1, 2, 3, 4, 5, 6],
  "calculadora-de-ajustes": [0, 1, 2, 3, 4, 5, 6],
  "calculadora-de-bonificaciones": [1, 2, 3, 4, 5, 6],
  "cargarprodudiaria": [1, 2, 3, 4, 5, 6],
  "registroguardia": [1, 2, 3, 4, 5, 6],
  "resumen-metricas-agente": [0, 1],
  "feedbackmanagement": [1],
  "historial-guardias": [1, 2, 3, 4, 5, 6],
  "kpiupload": [1],
  "panel-desarrollador": [1],
};

// Lista de correos con acceso especial a ciertas vistas
// Agregar aquí los emails del equipo que requieren acceso especial a cada vista
const ACCESOS_EXTRA = {
  "cargarprodudiaria": [
    // "usuario1@empresa.com",
    // "usuario2@empresa.com",
  ]
};

module.exports = { PERMISOS_VISTAS, ACCESOS_EXTRA };
