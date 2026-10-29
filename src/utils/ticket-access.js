const ALLOWED_RANGES = new Set([0, 1, 2, 3, 4, 5]);

function ticketRange(user) {
  const value = user?.rango;
  return ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
    && ALLOWED_RANGES.has(Number(value)) ? Number(value) : null;
}

function ticketPermissions(user) {
  const range = ticketRange(user);
  const enabled = range !== null;
  return {
    create: enabled,
    search: enabled,
    list: enabled && range !== 0,
    update: range === 1 || range === 5,
    metrics: enabled && range !== 0,
    export: enabled && range !== 0,
    createAlert: enabled && range !== 0,
    deleteAlert: enabled && range !== 0,
    previewProfile: range === 1
  };
}

function authorizeTicketSearch(req, res, search, scope = 'all') {
  const permissions = ticketPermissions(req.user);
  if (!permissions.search) {
    res.status(403).json({ error: 'El perfil no tiene acceso a la busqueda de tickets.' });
    return false;
  }
  if (!['all', 'mine'].includes(scope)) {
    res.status(400).json({ error: 'El alcance de busqueda no es valido.' });
    return false;
  }
  if (permissions.list || scope === 'mine') return true;
  if (typeof search === 'string' && /[\p{L}\p{N}]/u.test(search)
    && search.trim().toLowerCase() !== 'all' && !/[%_\\]/.test(search)) return true;
  res.status(403).json({ error: 'Los agentes deben buscar un dato concreto o consultar Mis tickets.' });
  return false;
}

function defaultTicketDates(search, scope, from, to) {
  if (scope === 'mine' || (search && search.trim().toLowerCase() !== 'all') || from || to) {
    return { from: from || null, to: to || null };
  }
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  start.setUTCDate(Math.min(today.getUTCDate(),
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()));
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

function ticketMatchesSearch(ticket, search) {
  const query = search.trim().toLowerCase();
  const matches = (value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).toLowerCase().includes(query);
    }
    if (Array.isArray(value)) return value.some(matches);
    return value !== null && typeof value === 'object'
      && Object.entries(value).some(([key, item]) => key !== 'imagenes' && matches(item));
  };
  return matches(ticket);
}

function roleCode(value) {
  if (Array.isArray(value)) return roleCode(value[0]);
  if (value && typeof value === 'object') {
    return roleCode(value.role ?? value.rol ?? value.code ?? value.codigo);
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function isBackOffice(user) {
  return ticketRange(user) === 5;
}

function hasBackOfficeAccess(user) {
  return ticketPermissions(user).update;
}

function canUseTicketing(user) {
  return ticketRange(user) !== null;
}

module.exports = {
  canUseTicketing, hasBackOfficeAccess, isBackOffice, roleCode,
  ticketRange, ticketPermissions, authorizeTicketSearch, defaultTicketDates, ticketMatchesSearch
};
