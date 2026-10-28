const { supabase } = require('../config/database');

const TICKET_TOOLS = [
  { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING', ticketera: 'ONBOARDING' },
  { id_herramienta: 11, nombre: 'TICKETERA_VENTAS', ticketera: 'VENTAS' },
  { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA', ticketera: 'DEGRA' }
];
const ALL_TICKETERA_RANGES = new Set([1, 3, 4]);

function normalizeTicketera(value) {
  const name = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toUpperCase()
    : '';
  if (name === '2') return 'VENTAS';
  if (name === '3') return 'ONBOARDING';
  if (name === '4') return 'DEGRA';
  if (name === '1') return 'SOPORTE';
  return ['ABONO/DEGRA', 'ABONO-DEGRA'].includes(name) ? 'DEGRA' : name;
}

async function loadTicketeraAccess(req, res, next) {
  if (req.ticketeraAccess) return next();
  const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (!email) return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  const rawRange = req.user?.rango;
  const range = !['number', 'string'].includes(typeof rawRange) || String(rawRange).trim() === ''
    ? NaN : Number(rawRange);
  if (!Number.isInteger(range) || range < 0 || range > 5) {
    return res.status(403).json({ error: 'El perfil no tiene acceso a la ticketera.' });
  }

  if (ALL_TICKETERA_RANGES.has(range)) {
    req.ticketeraAccess = TICKET_TOOLS;
    return next();
  }

  try {
    const { data, error } = await supabase.rpc('obtener_herramientas_usuario', { p_mail: email });
    if (error) throw error;
    if (!Array.isArray(data) || data.some((tool) => !tool || typeof tool.nombre !== 'string')) {
      console.error('Respuesta invalida de obtener_herramientas_usuario al autorizar Ticketera.');
      return res.status(502).json({ error: 'No se pudieron verificar las herramientas de Ticketera.' });
    }
    req.ticketeraAccess = TICKET_TOOLS.filter((required) => data.some((tool) =>
      Number(tool.id_herramienta) === required.id_herramienta
      || tool.nombre.trim().toUpperCase() === required.nombre
    ));
    return next();
  } catch (error) {
    console.error('Error al verificar el acceso a Ticketera:', error);
    return res.status(500).json({ error: 'No se pudieron verificar los permisos de Ticketera.' });
  }
}

function hasTicketeraAccess(req, ticketera) {
  return req.ticketeraAccess?.some((tool) => tool.ticketera === normalizeTicketera(ticketera)) === true;
}

function requireTicketeraAccess(ticketera) {
  return (req, res, next) => loadTicketeraAccess(req, res, () => {
    const allowed = ticketera
      ? hasTicketeraAccess(req, ticketera)
      : req.ticketeraAccess.length > 0;
    if (!allowed) {
      return res.status(403).json({ error: 'No tienes permisos para acceder a esta ticketera.' });
    }
    return next();
  });
}

function sendTicketeraAccess(req, res) {
  return res.json(req.ticketeraAccess.map(({ id_herramienta, nombre }) => ({ id_herramienta, nombre })));
}

function requireTicketeraCase(ticketera) {
  return async (req, res, next) => {
    const id = Number(req.body?.caso_id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'El caso_id debe ser un ID numerico valido.' });
    }
    try {
      const { data, error } = await supabase.schema('tickets_soporte')
        .from('ticketera_casos').select('tipo_ticketera').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'No existe un caso con ese ID.' });
      if (normalizeTicketera(data.tipo_ticketera) !== normalizeTicketera(ticketera)
        || !hasTicketeraAccess(req, data.tipo_ticketera)) {
        return res.status(403).json({ error: 'El caso no pertenece a la ticketera autorizada.' });
      }
      return next();
    } catch (error) {
      console.error('Error al verificar la ticketera del caso:', error);
      return res.status(500).json({ error: 'No se pudieron verificar los permisos del caso.' });
    }
  };
}

module.exports = {
  loadTicketeraAccess, hasTicketeraAccess, normalizeTicketera,
  requireTicketeraAccess, sendTicketeraAccess, requireTicketeraCase
};
