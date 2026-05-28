// Funciones auxiliares para procesamiento de archivos Excel

// Obtiene el índice de una columna en base a su nombre o número
function obtenerIndice(encabezados, columna) {
  if (typeof columna === 'number') return columna;
  return encabezados.findIndex(h => h?.toString().trim() === columna);
}

// Obtiene el valor de una celda en base al encabezado y la fila
function obtenerValor(encabezados, fila, columna) {
  const index = obtenerIndice(encabezados, columna);
  return index >= 0 && fila[index] ? fila[index].toString().trim() : null;
}

// Convierte un valor numérico de Excel a formato de hora HH:MM
function convertirHoraExcel(valor) {
  if (!valor || valor === '') return null;
  if (typeof valor === 'string' && valor.includes(':')) return valor;

  const num = typeof valor === 'string' ? parseFloat(valor) : valor;
  const totalSegundos = Math.floor(num * 24 * 60 * 60);
  const horas = Math.floor(totalSegundos / 3600) % 24;
  const minutos = Math.floor((totalSegundos % 3600) / 60);

  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

// Obtiene una hora desde una columna de Excel
function obtenerHora(encabezados, fila, columna) {
  const valor = obtenerValor(encabezados, fila, columna);
  return convertirHoraExcel(valor);
}

module.exports = {
  obtenerIndice,
  obtenerValor,
  convertirHoraExcel,
  obtenerHora
};
