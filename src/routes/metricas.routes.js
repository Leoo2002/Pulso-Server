// Rutas para métricas y productividad
const express = require('express');
const router = express.Router();
const { supabase, SUPABASE_URL, SUPABASE_KEY } = require('../config/database');
const { registerMetricas } = require('../services/metricas.service');
const { PERMISOS_VISTAS, ACCESOS_EXTRA } = require('../constants/permissions');

// Temporal: cualquier perfil con acceso a metricas puede consultar cualquier servicio/lider
// para validar la RPC. El control por roles se agregara mas adelante.
function contextoKpi(usuario) {
  if (!usuario) return null;
  const rango = typeof usuario.rango === 'number' || typeof usuario.rango === 'string'
    ? Number(String(usuario.rango).trim() || NaN) : NaN;
  const segmentos = Array.isArray(usuario.segmento) ? usuario.segmento : [usuario.segmento];
  const servicios = [...new Set(segmentos.filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim()))];
  const lider = typeof usuario.lider === 'string' ? usuario.lider.trim() : '';
  if (!PERMISOS_VISTAS.metricas.includes(rango)) return null;
  return { servicios, lider: lider || null, restringido: false };
}

router.get('/kpis/contexto', (req, res) => {
  const contexto = contextoKpi(req.user);
  if (!contexto) {
    return res.status(req.user ? 403 : 401).json({ error: 'La sesion no permite consultar KPIs.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(contexto);
});

const textoKpi = valor => typeof valor === 'string' && valor.length <= 250;
const enteroEntre = (min, max) => valor => Number.isInteger(valor) && valor >= min && valor <= max;

// extras: filtros propios de cada RPC ({ campo: validador }); se envian solo si vienen informados.
function registrarConsultaKpi(ruta, rpc, nombre, validarRespuesta, extras = {}, nombreServicio = 'servicio') {
  router.post(ruta, async (req, res) => {
    const contexto = contextoKpi(req.user);
    if (!contexto) {
      return res.status(req.user ? 403 : 401).json({ error: 'La sesion no permite consultar KPIs.' });
    }
    const filtros = req.body;
    const campos = ['servicio', 'fecha_desde', 'fecha_hasta', 'filtro_canal',
      'filtro_empleado_id', 'filtro_legajo', 'filtro_lider', ...Object.keys(extras)];
    const fechaValida = valor => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
      && !Number.isNaN(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor;
    if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros)
      || Object.keys(filtros).some(campo => !campos.includes(campo))
      || typeof filtros.servicio !== 'string' || !filtros.servicio.trim()
      || !fechaValida(filtros.fecha_desde)
      || (filtros.fecha_hasta != null && (!fechaValida(filtros.fecha_hasta)
        || filtros.fecha_hasta < filtros.fecha_desde))
      || ['filtro_canal', 'filtro_legajo', 'filtro_lider'].some(campo =>
        filtros[campo] != null && (typeof filtros[campo] !== 'string' || filtros[campo].length > 250))
      || (filtros.filtro_empleado_id != null && (!Number.isInteger(filtros.filtro_empleado_id)
        || filtros.filtro_empleado_id < 1 || filtros.filtro_empleado_id > 2147483647))
      || (filtros.filtro_empleado_id != null && filtros.filtro_legajo?.trim())
      || Object.entries(extras).some(([campo, valido]) => filtros[campo] != null && !valido(filtros[campo]))) {
      return res.status(400).json({ error: `Los filtros de ${nombre} no son validos.` });
    }
    const servicio = filtros.servicio.trim();
    const parametros = {
      [nombreServicio]: servicio,
      fecha_desde: filtros.fecha_desde,
      fecha_hasta: filtros.fecha_hasta ?? null,
      filtro_canal: filtros.filtro_canal?.trim() || null,
      filtro_empleado_id: filtros.filtro_empleado_id ?? null,
      filtro_legajo: filtros.filtro_legajo?.trim() || null,
      filtro_lider: filtros.filtro_lider?.trim() || null
    };
    for (const campo of Object.keys(extras)) {
      const valor = typeof filtros[campo] === 'string' ? filtros[campo].trim() || null : filtros[campo];
      if (valor != null) parametros[campo] = valor;
    }
    const controlador = new AbortController();
    const limite = setTimeout(() => {
      console.error(`Tiempo de espera agotado en ${rpc} (30 segundos).`);
      controlador.abort();
      if (!res.destroyed) {
        res.status(504).json({ error: `La consulta de ${nombre} demoró más de 30 segundos. Reintentá; si se repite, hay que revisar su rendimiento en Supabase.` });
      }
    }, 30000);
    const cancelar = () => {
      if (!res.writableEnded) {
        clearTimeout(limite);
        controlador.abort();
      }
    };
    res.once('close', cancelar);
    try {
      const { data, error } = await supabase.rpc(rpc, parametros).abortSignal(controlador.signal);
      if (controlador.signal.aborted) return;
      if (error) {
        console.error(`Error en ${rpc}:`, error);
        if (error.code === 'PGRST202' && rpc.startsWith('consultar_fcr_')) {
          return res.status(503).json({ error: 'Faltan las funciones optimizadas de FCR en Supabase. Ejecutá la migración de FCR.' });
        }
        return res.status(error.code === 'P0001' ? 400 : 500).json({
          error: error.code === 'P0001' ? error.message : `No se pudo consultar ${nombre}.`
        });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || !data.periodo || !validarRespuesta(data, servicio)) {
        console.error(`Respuesta invalida de ${rpc}.`);
        return res.status(502).json({ error: `${nombre} devolvio un formato inesperado.` });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json(rpc === 'consultar_nps' ? { ...data, servicio: servicio.toUpperCase() } : data);
    } catch (error) {
      if (controlador.signal.aborted) return;
      console.error(`Error inesperado al consultar ${nombre}:`, error);
      return res.status(500).json({ error: `No se pudo consultar ${nombre}.` });
    } finally {
      clearTimeout(limite);
      res.removeListener('close', cancelar);
    }
  });
}

const respuestaPorLider = data => !!data.general && Array.isArray(data.por_lider);

registrarConsultaKpi('/kpis/productividad', 'consultar_cxh', 'productividad',
  (data, servicio) => respuestaPorLider(data) && ['diaria', 'mensual'].includes(data.fuente) && data.servicio === servicio);
registrarConsultaKpi('/kpis/nps', 'consultar_nps', 'NPS',
  data => respuestaPorLider(data) && Number.isInteger(data.general.cantidad_encuestas)
    && Number.isInteger(data.general.cantidad_calificadas) && Number.isFinite(data.general.nps));
registrarConsultaKpi('/kpis/nps/detalle', 'consultar_nps_detalle', 'las encuestas NPS',
  data => Number.isInteger(data.total) && Number.isInteger(data.pagina) && Array.isArray(data.encuestas), {
    filtro_agente: textoKpi,
    filtro_tipo: valor => ['PROMOTOR', 'NEUTRO', 'DETRACTOR', 'SIN_CALIFICACION'].includes(valor),
    filtro_etiqueta_nivel: enteroEntre(1, 4),
    filtro_etiqueta: textoKpi,
    busqueda: textoKpi,
    pagina: enteroEntre(1, 100000),
    tamano_pagina: enteroEntre(1, 200)
  });
registrarConsultaKpi('/kpis/nps/textos', 'consultar_nps_textos', 'los comentarios NPS',
  data => Number.isInteger(data.sin_etiqueta) && Array.isArray(data.por_nota)
    && Array.isArray(data.por_etiqueta) && Array.isArray(data.palabras), {
    filtro_agente: textoKpi,
    limite_palabras: enteroEntre(1, 200)
  });
registrarConsultaKpi('/kpis/fcr', 'consultar_fcr_resumen', 'FCR',
  (data, servicio) => data.servicio === servicio.toUpperCase() && respuestaPorLider(data) && Number.isInteger(data.general.cantidadRegistros)
    && Number.isFinite(data.general.totalInteracciones) && Number.isFinite(data.general.totalRecallEfectivo),
  {}, 'filtro_servicio');
registrarConsultaKpi('/kpis/fcr/tabulaciones', 'consultar_fcr_tabulaciones', 'las tabulaciones FCR',
  (data, servicio) => data.servicio === servicio.toUpperCase() && Number.isInteger(data.total)
    && Number.isInteger(data.sin_etiqueta) && Array.isArray(data.categorias), {
    filtro_agente: textoKpi,
    filtro_jefe: textoKpi,
    filtro_lider_sin_asignar: valor => typeof valor === 'boolean',
    filtro_contacto: valor => ['PRIMERO', 'SEGUNDO'].includes(valor),
    nivel: enteroEntre(1, 4),
    limite: enteroEntre(1, 50)
  }, 'filtro_servicio');
registrarConsultaKpi('/kpis/fcr/detalle', 'consultar_fcr_detalle', 'el detalle FCR',
  (data, servicio) => data.servicio === servicio.toUpperCase() && Number.isInteger(data.total)
    && Number.isInteger(data.pagina) && Array.isArray(data.registros), {
    filtro_agente: textoKpi,
    filtro_jefe: textoKpi,
    filtro_lider_sin_asignar: valor => typeof valor === 'boolean',
    filtro_recall: valor => ['CON_RECALL', 'SIN_RECALL'].includes(valor),
    filtro_tab_contacto: valor => ['PRIMERO', 'SEGUNDO'].includes(valor),
    filtro_tab_nivel: enteroEntre(1, 4),
    filtro_tab: textoKpi,
    busqueda: textoKpi,
    pagina: enteroEntre(1, 100000),
    tamano_pagina: enteroEntre(1, 200)
  }, 'filtro_servicio');

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
  const usuario = req.user;
  const rango = usuario?.rango === null || usuario?.rango === undefined || String(usuario.rango).trim() === ''
    ? NaN
    : Number(usuario.rango);
  const tieneAccesoPorRango = PERMISOS_VISTAS.cargarprodudiaria.includes(rango);
  const tieneAccesoEspecial = ACCESOS_EXTRA.cargarprodudiaria.includes(usuario?.email);

  if (!tieneAccesoPorRango && !tieneAccesoEspecial) {
    return res.status(403).json({ error: "Acceso denegado: permiso insuficiente" });
  }

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
