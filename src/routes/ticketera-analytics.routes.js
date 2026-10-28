const express = require('express');
const { supabase } = require('../config/database');
const { canUseTicketing } = require('../utils/ticket-access');
const { requireTicketeraAccess } = require('../middlewares/ticketera-access');

const router = express.Router();
const arrays = ['lideres', 'canales', 'tipos', 'estados'];
const scalar = ['desde', 'hasta', 'granularidad', 'zona_horaria'];
const detailScalar = ['dimension', 'valor', 'motivo', 'pagina', 'tamano'];

function parseFilters(body, detail) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Los filtros deben ser un objeto.');
  }
  const allowed = new Set([...arrays, ...scalar, ...(detail ? detailScalar : [])]);
  const params = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) throw new Error(`Filtro no admitido: ${key}.`);
    if (value === null || value === '') continue;
    if (arrays.includes(key)) {
      if (!Array.isArray(value) || value.length > 200
        || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 250)) {
        throw new Error(`El filtro ${key} debe contener una lista de valores válidos.`);
      }
    } else if (key === 'pagina' || key === 'tamano') {
      if (!Number.isSafeInteger(value) || value < 1 || (key === 'tamano' && value > 100)) {
        throw new Error('La página o el tamaño no son válidos.');
      }
    } else if (typeof value !== 'string' || value.length > 250) {
      throw new Error(`El filtro ${key} no es válido.`);
    }
    params[`p_${key}`] = value;
  }
  return params;
}

function handler(detail, exporting = false) {
  return async (req, res) => {
    const range = Number(req.user?.rango);
    if (!canUseTicketing(req.user) || !Number.isInteger(range) || range === 0) {
      return res.status(403).json({ error: 'No tienes permisos para consultar las métricas.' });
    }
    let params;
    try {
      params = parseFilters(req.body, detail);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (detail) delete params.p_granularidad;
    try {
      const rpc = exporting ? 'exportar_analitica_ticketera_onboarding'
        : detail ? 'obtener_detalle_analitica_ticketera_onboarding' : 'obtener_analitica_ticketera_onboarding';
      const { data, error } = await supabase.rpc(rpc, params);
      if (error) {
        console.error(`Error en ${rpc}:`, error);
        return res.status(error.code === '22023' || error.code === '22007' ? 400 : 500)
          .json({ error: error.code === '22023' ? error.message : 'No se pudo consultar la analítica de Ticketera.' });
      }
      const validAnalytics = (value) => value && typeof value === 'object'
        && value.kpis && value.distribuciones && Array.isArray(value.volumen);
      const validExport = () => validAnalytics(data.analitica)
        && Array.isArray(data.columnas) && data.columnas.length > 0
        && data.columnas.every((column) => typeof column === 'string' && column.length > 0)
        && new Set(data.columnas).size === data.columnas.length
        && Array.isArray(data.items) && data.total === data.items.length
        && data.items.every((item) => item && typeof item === 'object' && !Array.isArray(item)
          && Object.keys(item).every((key) => data.columnas.includes(key)));
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || (exporting ? !validExport() : detail ? !Array.isArray(data.items) : !validAnalytics(data))) {
        console.error(`Respuesta inválida de ${rpc}.`);
        return res.status(502).json({ error: 'La analítica devolvió un formato inesperado.' });
      }
      if (!detail && !exporting && data.calidad_datos?.sin_fecha_carga > 0) {
        let query = supabase.schema('tickets_soporte').from('ticketera_analitica_base')
          .select('caso_id,id_tck,estado').is('fecha_carga', null);
        for (const [filter, column] of [['lideres', 'lider'], ['canales', 'canal'], ['tipos', 'tipo']]) {
          if (params[`p_${filter}`]?.length) query = query.in(column, params[`p_${filter}`]);
        }
        const { data: cases, error: casesError } = await query;
        if (casesError || !Array.isArray(cases)) {
          console.error('Error al identificar los casos sin fecha de creación:', casesError);
          return res.status(500).json({ error: 'No se pudieron identificar los casos sin fecha de creación.' });
        }
        data.calidad_datos.casos_sin_fecha = cases.map((item) => ({
          caso_id: item.caso_id,
          id_tck: item.id_tck,
          excluido_por_fechas: Boolean(params.p_desde || params.p_hasta)
            && (!params.p_estados?.length || params.p_estados.includes(item.estado))
        }));
      }
      return res.json(data);
    } catch (error) {
      console.error('Error inesperado en analítica de Ticketera:', error);
      return res.status(500).json({ error: 'No se pudo consultar la analítica de Ticketera.' });
    }
  };
}

router.post('/tickets/analytics', requireTicketeraAccess('ONBOARDING'), handler(false));
router.post('/tickets/analytics/detail', requireTicketeraAccess('ONBOARDING'), handler(true));
router.post('/tickets/analytics/export', requireTicketeraAccess('ONBOARDING'), handler(false, true));

module.exports = router;
