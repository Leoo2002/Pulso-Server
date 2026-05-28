// Constantes para la carga de programación desde archivos Excel
const COLUMNAS = {
  DNI: 'DNI',
  NOMBRE: 'Nombre',
  EQUIPO: 'Equipo',
  SEGMENTO: 'Segmento',
  H_INGRESO: 4,
  LUNES: 'Lunes',
  MARTES: 'Martes',
  MIERCOLES: 'Miercoles',
  JUEVES: 'Jueves',
  VIERNES: 'Viernes',
  SABADO: 'Sábado',
  DOMINGO: 'Domingo',
  INGRESO_LUNES: 12,
  INGRESO_MARTES: 14,
  INGRESO_MIERCOLES: 16,
  INGRESO_JUEVES: 18,
  INGRESO_VIERNES: 20,
  INGRESO_SABADO: 22,
  INGRESO_DOMINGO: 24,
  BREAK_LUNES: 26,
  BREAK_MARTES: 29,
  BREAK_MIERCOLES: 32,
  BREAK_JUEVES: 35,
  BREAK_VIERNES: 38,
  BREAK_SABADO: 41,
  BREAK_DOMINGO: 44,
  AGENDA_LUNES: 'Agenda Lunes',
  AGENDA_MARTES: 'Agenda Martes',
  AGENDA_MIERCOLES: 'Agenda Miercoles',
  AGENDA_JUEVES: 'Agenda Jueves',
  AGENDA_VIERNES: 'Agenda Viernes',
  AGENDA_SABADO: 'Agenda Sabado',
  AGENDA_DOMINGO: 'Agenda Domingo',
  TRAINING_LUNES: 'Training Lunes',
  TRAINING_MARTES: 'Training Martes',
  TRAINING_MIERCOLES: 'Training Miercoles',
  TRAINING_JUEVES: 'Training Jueves',
  TRAINING_VIERNES: 'Training Viernes',
  TRAINING_SABADO: 'Training Sabado',
  TRAINING_DOMINGO: 'Training Domingo'
};

const CONFIG_EXCEL = {
  headerRow: 1,
  tableName: 'prograprueba2',
  batchSize: 30
};

module.exports = { COLUMNAS, CONFIG_EXCEL };
