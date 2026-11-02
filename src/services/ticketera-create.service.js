const { supabase } = require('../config/database');

async function createTicketeraCase(service, ticket, email) {
  const rpcTicket = { ...ticket, email };
  const normalizedService = service.trim().toUpperCase();
  const trackerType = typeof ticket.tipo === 'string' ? ticket.tipo.trim().toUpperCase() : '';
  const rpcService = normalizedService === 'ONBOARDING'
    && ['ETRACKER', 'TICKY', 'ITRACKER'].includes(trackerType)
    ? 'IT'
    : service;

  if (normalizedService === 'DEGRA') {
    rpcTicket.tipo_reg = ticket.tipo_reclamo_circuito;
  }

  const { data, error } = await supabase.rpc('crear_ticket_ticketera', {
    p_servicio: rpcService,
    p_ticket: rpcTicket
  });
  if (error) throw error;

  const result = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : { caso_id: data };
  const casoId = Number(result.caso_id ?? result.id);
  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    throw new Error('crear_ticket_ticketera devolvió una respuesta sin caso_id válido.');
  }

  return {
    ...result,
    caso_id: casoId,
    id_tck: typeof result.id_tck === 'string' && result.id_tck.trim()
      ? result.id_tck.trim()
      : null
  };
}

module.exports = { createTicketeraCase };
