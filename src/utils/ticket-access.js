const ALLOWED_RANGES = new Set([0, 1, 2, 3, 4, 5, 6]);

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
  return Number(user?.rango) === 5;
}

function canUseTicketing(user) {
  return isBackOffice(user) || ALLOWED_RANGES.has(Number(user?.rango));
}

module.exports = { canUseTicketing, isBackOffice, roleCode };
