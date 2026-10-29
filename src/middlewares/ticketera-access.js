const { supabase } = require('../config/database');
const { ticketRange, ticketPermissions } = require('../utils/ticket-access');

const TICKET_TOOLS = [
  { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING', ticketera: 'ONBOARDING' },
  { id_herramienta: 11, nombre: 'TICKETERA_VENTAS', ticketera: 'VENTAS' },
  { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA', ticketera: 'DEGRA' }
];

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

function loadTicketeraAccess(req, res, next) {
  if (req.ticketeraAccess) return next();
  const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (!email) return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  if (ticketRange(req.user) === null) {
    return res.status(403).json({ error: 'El perfil no tiene acceso a la ticketera.' });
  }

  const tools = req.user.herramientas;
  if (!Array.isArray(tools) || tools.some((tool) => !tool || typeof tool.nombre !== 'string'
    || !['number', 'string'].includes(typeof tool.id_herramienta))) {
    console.warn('JWT sin asignaciones de herramientas validas para Ticketera.');
    return res.status(403).json({ error: 'La sesion no contiene herramientas validas. Volve a iniciar sesion.' });
  }
  req.ticketeraAccess = TICKET_TOOLS.filter((required) => tools.some((tool) =>
    Number(tool.id_herramienta) === required.id_herramienta
    && tool.nombre.trim().toUpperCase() === required.nombre
  ));
  return next();
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

function sendTicketeraPolicy(req, res) {
  const user = req.user;
  return res.json({
    herramientas: req.ticketeraAccess.map(({ id_herramienta, nombre }) => ({ id_herramienta, nombre })),
    permisos: ticketPermissions(user),
    perfil: {
      email: user.email, rango: ticketRange(user), rol: user.rol,
      usuario: user.usuario ?? null,
      segmentos: Array.isArray(user.segmento)
        ? user.segmento.map((segmento) => ({ segmento }))
        : typeof user.segmento === 'string' ? [{ segmento: user.segmento }] : []
    }
  });
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
  requireTicketeraAccess, sendTicketeraAccess, sendTicketeraPolicy, requireTicketeraCase
};
