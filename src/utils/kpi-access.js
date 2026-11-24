function hasKpiTool(user) {
  return Array.isArray(user?.herramientas) && user.herramientas.some((tool) => {
    if (!tool || typeof tool !== 'object') return false;
    const id = tool.id_herramienta;
    return ['number', 'string'].includes(typeof id) && Number(id) === 6;
  });
}

function canAccessKpis(user) {
  return Number(user?.rango) === 1 || hasKpiTool(user);
}

module.exports = { hasKpiTool, canAccessKpis };
