// Rutas para métricas y productividad
const express = require('express');
const router = express.Router();
const { supabase, SUPABASE_URL, SUPABASE_KEY } = require('../config/database');
const { registerMetricas } = require('../services/metricas.service');

// Obtener métricas en formato CSV
router.get("/metricas", async (req, res) => {
  const { data, error } = await supabase.rpc('generar_csv_agentes');

  if (error) {
    console.error("Error al generar CSV:", error);
    return res.status(500).json({ error: error.message });
  }

  const csv = data;

  res.setHeader('Content-Disposition', 'attachment; filename="agentes.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

// Obtener fecha actual
router.get("/fechaActual", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_fecha_hoy');
  if (error) console.error(error);
  else res.json(data);
});

// Cargar productividad diaria
router.post("/produDiaria", async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      throw new Error("El cuerpo de la solicitud debe ser un array");
    }

    const BATCH_SIZE = 500;
    const totalRecords = req.body.length;
    let processedRecords = 0;
    const results = [];
    const errors = [];

    // Procesar por lotes
    for (let i = 0; i < totalRecords; i += BATCH_SIZE) {
      const batch = req.body.slice(i, i + BATCH_SIZE);

      try {
        const { data, error } = await supabase
          .rpc('call_kpi_set_datos_produ_diaria', {
            json_input: batch
          });

        if (error) {
          console.error(`Error en lote ${i / BATCH_SIZE + 1}:`, {
            message: error.message,
            details: error.details,
            code: error.code,
            hint: error.hint || 'No hay sugerencia disponible'
          });
          errors.push({
            batch: i / BATCH_SIZE + 1,
            error: error.message,
            records: batch
          });
        } else {
          processedRecords += batch.length;
          results.push(...(data || []));
        }
      } catch (batchError) {
        console.error(`Error procesando lote ${i / BATCH_SIZE + 1}:`, batchError);
        errors.push({
          batch: i / BATCH_SIZE + 1,
          error: batchError.message,
          records: batch
        });
      }
    }

    // Respuesta final
    if (errors.length > 0) {
      return res.status(207).json({
        success: errors.length < Math.ceil(totalRecords / BATCH_SIZE),
        processed: processedRecords,
        total: totalRecords,
        batches: Math.ceil(totalRecords / BATCH_SIZE),
        errors: errors,
        results: results,
        message: `Procesado con algunos errores (${processedRecords}/${totalRecords} registros)`
      });
    }

    return res.json({
      success: true,
      processed: processedRecords,
      batches: Math.ceil(totalRecords / BATCH_SIZE),
      data: results,
      message: `Todos los datos procesados correctamente (${totalRecords} registros)`
    });

  } catch (error) {
    console.error("Error en el servidor:", {
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: "Error interno del servidor",
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Obtener productividad diaria
router.get("/TraerProdu", async (req, res) => {
  try {
    const mail_lider = req.query.email;
    const { data, error } = await supabase
      .rpc('call_kpi_get_productividad_diaria', { mail_lider: mail_lider });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Error en Supabase" });
    }

    console.log("Datos desde Supabase:", data);
    res.status(200).json(data);

  } catch (err) {
    console.error("Error general:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Obtener productividad diaria por agente
router.get("/produDiariaPorAgente", async (req, res) => {
  const agente = req.query.email;

  const { data, error } = await supabase
    .rpc('call_get_productividad_diaria_poragente', {
      mail_agente: agente
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Obtener productividad diaria por equipo
router.get("/produDiariaPorEquipo", async (req, res) => {
  const mail_lider = req.query.email;

  const { data, error } = await supabase
    .rpc('call_kpi_get_productividad_diaria', {
      mail_lider
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Setear último intervalo de carga
router.post("/produDiaria/setearUltimoIntervalo", async (req, res) => {
  const mail = req.query.mail;

  let { data, error } = await supabase
    .rpc('call_kpi_set_carga_productividad_diara', {
      mail
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Obtener último intervalo de carga
router.get("/produDiaria/obtenerUltimoIntervalo", async (req, res) => {
  let { data, error } = await supabase
    .rpc('call_kpi_get_carga_productividad_diaria');

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Vaciar tabla de productividad diaria
router.post("/produDiaria/vaciarTabla", async (req, res) => {
  let { data, error } = await supabase
    .rpc('call_kpi_delete_productividad_diaria');

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Setear feedback
router.post("/feedback", async (req, res) => {
  const feedback = req.body;

  let { data, error } = await supabase
    .rpc('set_feedback', {
      json_datos: feedback
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Obtener todos los feedbacks
router.get("/feedback/all", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_feedback');

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Obtener NPS por equipo
/*router.get("/nps", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: "El parámetro 'email' es requerido." });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_nps_encuestas?mail=${encodeURIComponent(email)}&fecha_inicio=2026-02-01&fecha_fin=2026-02-11`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'kpi'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error en la consulta NPS:", errorData);
      return res.status(response.status).json({
        error: "Error al obtener datos de NPS",
        details: errorData.message || `HTTP error! status: ${response.status}`
      });
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      console.log(`No se encontraron datos NPS para el líder: ${email}`);
      return res.status(404).json({
        message: "No se encontraron datos de NPS para este líder",
        data: []
      });
    }

    console.log(`Datos NPS obtenidos para ${email}:`, data.length, "registros");
    res.json(data);

  } catch (error) {
    console.error("Error al obtener NPS:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      message: error.message
    });
  }
});*/

router.get("/nps", async (req, res) => {

  const { email, fecha_inicio, fecha_fin } = req.query;

  if (!email) {
    return res.status(400).json({
      error: "El parámetro 'email' es requerido."
    });
  }

  try {

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_nps_encuestas`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Accept-Profile': 'kpi',
          'Content-Profile': 'kpi'
        }
        ,
        body: JSON.stringify({
          mail: email,
          fecha_inicio,
          fecha_fin
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Error en la consulta NPS:", data);

      return res.status(response.status).json({
        error: "Error al obtener datos de NPS",
        details: data?.message || response.statusText
      });
    }

    if (!Array.isArray(data) || data.length === 0) {

      console.log(`No se encontraron datos NPS para: ${email}`);

      return res.status(404).json({
        message: "No se encontraron datos de NPS",
        data: []
      });
    }

    console.log(`Datos NPS obtenidos para ${email}:`, data.length, "registros");

    res.json(data);

  } catch (error) {

    console.error("Error al obtener NPS:", error);

    return res.status(500).json({
      error: "Error interno del servidor",
      message: error.message
    });
  }
});

// Obtener productividad completa
router.get("/produCompleta", async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_productividad_diaria_completa`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'kpi'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error en la consulta NPS:", errorData);
      return res.status(response.status).json({
        error: "Error al obtener datos de NPS",
        details: errorData.message || `HTTP error! status: ${response.status}`
      });
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return res.json({
        message: "No se encontraron datos de NPS para este líder",
        data: []
      });
    }

    res.json(data);

  } catch (error) {
    console.error("Error al obtener NPS:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      message: error.message
    });
  }
});

// Registrar endpoints de subida (cargarFCR, cargarNPS, cargarREL)
registerMetricas(router);

// Debug: contar filas en kpi.datos_resolucion
router.get('/debug/datos_resolucion/count', async (req, res) => {
  try {
    const { data, count, error } = await supabase.from('kpi.datos_resolucion').select('*', { count: 'exact' });
    if (error) {
      console.error('Error contando datos_resolucion:', error);
      return res.status(500).json({ error });
    }
    return res.json({ count: count ?? (data ? data.length : 0) });
  } catch (err) {
    console.error('Error en /debug/datos_resolucion/count:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Debug: obtener una muestra de filas de kpi.datos_resolucion
router.get('/debug/datos_resolucion/sample', async (req, res) => {
  try {
    const { data, error } = await supabase.from('kpi.datos_resolucion').select('*').limit(10);
    if (error) {
      console.error('Error obteniendo sample datos_resolucion:', error);
      return res.status(500).json({ error });
    }
    return res.json({ sample: data });
  } catch (err) {
    console.error('Error en /debug/datos_resolucion/sample:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;


