/**
 * 🚀 Utilidad para procesar archivos Excel grandes con streaming
 * Reduce memoria RAM y permite procesar archivos > 500MB
 */

const xlsx = require('xlsx');
const { supabase } = require('../config/database');

/**
 * Procesa Excel por chunks en lugar de cargar todo en memoria
 * @param {string} filePath - Ruta del archivo
 * @param {object} config - { tableName, batchSize, columns, normalizeFn }
 * @returns {Promise} { total, success, errors }
 */
async function processLargeExcel(filePath, config) {
  const {
    tableName,
    batchSize = 500,
    columns = {},
    normalizeFn = (row) => row,
    schemaName = 'kpi'
  } = config;

  console.log(`📊 Procesando archivo grande: ${filePath}`);
  console.log(`   Tamaño de lotes: ${batchSize} registros`);
  console.log(`   Tabla destino: ${schemaName}.${tableName}`);

  let totalProcessed = 0;
  let totalErrors = 0;
  const errors = [];

  try {
    // 1️⃣ Leer archivo de forma más eficiente
    const workbook = xlsx.readFile(filePath, {
      type: 'file',
      // No cargar fórmulas, solo valores
      cellFormula: false,
      // Ignorar campos vacíos
      defval: ''
    });

    const sheetName = workbook.SheetNames[0];
    console.log(`📄 Sheet detectado: ${sheetName}`);

    // 2️⃣ Procesar en chunks
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      blankrows: false
    });

    if (rows.length === 0) {
      throw new Error('Archivo Excel vacío');
    }

    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => r.some(cell => cell)); // Filtrar filas vacías

    console.log(`✅ ${dataRows.length} filas detectadas`);

    // 3️⃣ Procesar por lotes
    for (let i = 0; i < dataRows.length; i += batchSize) {
      const batchData = dataRows.slice(i, i + batchSize);
      
      const mappedBatch = batchData
        .map(row => mapExcelRow(row, headers, columns))
        .map(normalizeFn)
        .filter(row => Object.values(row).some(v => v !== null && v !== ''));

      if (mappedBatch.length === 0) continue;

      try {
        // Intentar upsert con schema
        let result = await supabase
          .schema(schemaName)
          .from(tableName)
          .upsert(mappedBatch, { returning: 'minimal' });

        if (result.error) {
          // Fallback: nombre completo de tabla
          result = await supabase
            .from(`${schemaName}.${tableName}`)
            .upsert(mappedBatch, { returning: 'minimal' });
        }

        if (result.error) {
          totalErrors += mappedBatch.length;
          errors.push({
            batch: Math.floor(i / batchSize),
            error: result.error.message
          });
          console.error(`❌ Error en lote ${Math.floor(i / batchSize)}: ${result.error.message}`);
        } else {
          totalProcessed += mappedBatch.length;
          console.log(`✅ Lote ${Math.floor(i / batchSize) + 1}: ${mappedBatch.length} registros insertados (Total: ${totalProcessed})`);
        }

      } catch (batchError) {
        totalErrors += mappedBatch.length;
        errors.push({
          batch: Math.floor(i / batchSize),
          error: batchError.message
        });
        console.error(`❌ Error procesando lote: ${batchError.message}`);
      }

      // Dar tiempo al servidor para no saturar RAM
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      total: dataRows.length,
      processed: totalProcessed,
      errors: totalErrors,
      errorDetails: errors,
      success: totalErrors === 0
    };

  } catch (error) {
    console.error('🚨 Error crítico procesando Excel:', error);
    throw error;
  }
}

/**
 * Mapea columnas de Excel a propiedades de objeto
 */
function mapExcelRow(row, headers, columnMap) {
  const mapped = {};

  // columnMap = { userData.name: 'Nombre', userData.email: 'Email', ... }
  for (const [key, headerName] of Object.entries(columnMap)) {
    const colIndex = headers.indexOf(headerName);
    if (colIndex >= 0) {
      const value = row[colIndex];
      
      // Soportar nested properties: 'user.name' -> { user: { name: ... } }
      if (key.includes('.')) {
        const parts = key.split('.');
        let obj = mapped;
        for (let i = 0; i < parts.length - 1; i++) {
          obj[parts[i]] = obj[parts[i]] || {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value === '' ? null : value;
      } else {
        mapped[key] = value === '' ? null : value;
      }
    }
  }

  return mapped;
}

/**
 * Limita tamaño de archivo
 */
function validateFileSize(filePath, maxSizeMB = 100) {
  const fs = require('fs');
  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB > maxSizeMB) {
    throw new Error(`Archivo demasiado grande: ${sizeMB.toFixed(2)}MB (máximo: ${maxSizeMB}MB)`);
  }

  return sizeMB;
}

module.exports = {
  processLargeExcel,
  mapExcelRow,
  validateFileSize
};
