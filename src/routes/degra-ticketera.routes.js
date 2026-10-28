const express = require('express');
const { supabase } = require('../config/database');
const { hasBackOfficeAccess } = require('../utils/ticket-access');
const { requireTicketeraAccess } = require('../middlewares/ticketera-access');
const { createTicketeraCase } = require('../services/ticketera-create.service');
const router = express.Router();
const ALLOWED_STATUSES = new Set([
  'pendiente',
  'en_curso',
  'resuelto',
  'cancelado',
  'mal_cargado',
  'cancelado_duplicado',
  'cancelado_no_corresponde'
]);
const MAX_LENGTHS = {
  canal: 120,
  usuario: 80,
  nombre: 150,
  lider: 150,
  site_ubicacion: 150,
  especialidad: 150,
  telefono_contacto: 30,
  email_cliente: 254,
  tipo_reclamo_circuito: 150,
  motivo_principal: 150,
  submotivo: 150,
  numero_caso: 80,
  linea_msisdn: 40,
  detalle_observacion: 5000
};
const REQUIRED_FIELDS = [
  'canal',
  'usuario',
  'nombre',
  'requiere_contacto',
  'lider',
  'site_ubicacion',
  'especialidad',
  'tipo_reclamo_circuito',
  'motivo_principal',
  'submotivo',
  'linea_msisdn',
  'detalle_observacion'
];

const requireDegraTool = requireTicketeraAccess('DEGRA');

function normalizeTicket(ticket) {
  const normalized = {};
  for (const [field, maxLength] of Object.entries(MAX_LENGTHS)) {
    const value = ticket[field];
    if (value === undefined || value === null) {
      normalized[field] = '';
    } else if (typeof value !== 'string') {
      return { error: `El campo ${field} debe ser texto.` };
    } else {
      normalized[field] = value.trim();
      if (normalized[field].length > maxLength) {
        return { error: `El campo ${field} supera el máximo de ${maxLength} caracteres.` };
      }
    }
  }

  normalized.requiere_contacto = typeof ticket.requiere_contacto === 'boolean'
    ? String(ticket.requiere_contacto)
    : typeof ticket.requiere_contacto === 'string'
      ? ticket.requiere_contacto.trim()
      : '';
  const missingField = REQUIRED_FIELDS.find((field) => !normalized[field]);
  if (missingField) return { error: 'Completá todos los campos obligatorios del ticket de Degra.' };

  const requiresContact = String(ticket.requiere_contacto).trim().toLocaleLowerCase('es');
  if (!['true', 'false', 'si', 'sí', 'no'].includes(requiresContact)) {
    return { error: 'El campo requiere_contacto debe ser Sí o No.' };
  }
  normalized.requiere_contacto = ['true', 'si', 'sí'].includes(requiresContact) ? 'true' : 'false';

  if (normalized.telefono_contacto && !/^[+0-9() -]{7,30}$/.test(normalized.telefono_contacto)) {
    return { error: 'Revisá el formato del teléfono de contacto.' };
  }
  if (normalized.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email_cliente)) {
    return { error: 'Revisá el formato del mail de contacto.' };
  }
  return { ticket: normalized };
}

router.post('/crearTicketeraTicketDegra', requireDegraTool, async (req, res) => {
  const ticket = req.body?.ticket;
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({ error: 'Los datos del ticket de Degra son obligatorios.' });
  }

  const normalized = normalizeTicket(ticket);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const creatorEmail = req.user.email.trim();
  try {
    const result = await createTicketeraCase('DEGRA', {
      ...normalized.ticket,
      observacion_inicial: normalized.ticket.detalle_observacion
    }, creatorEmail);
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error inesperado al crear ticket de Degra:', error);
    const statusCode = error.code === 'P0001' || error.code === '22007' ? 400 : 500;
    return res.status(statusCode).json({
      error: 'No se pudo crear el ticket de Degra.',
      ...(statusCode === 400 ? { detalle: error.message } : {})
    });
  }
});

router.get('/obtenerTicketsDegra', requireDegraTool, async (req, res) => {
  const search = typeof req.query.p_busqueda === 'string' ? req.query.p_busqueda.trim() : 'All';
  const scope = typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : 'all';
  const casoId = req.query.caso_id === undefined ? null : Number(req.query.caso_id);
  if (search.length > 100) return res.status(400).json({ error: 'La búsqueda no puede superar los 100 caracteres.' });
  if (!['all', 'mine'].includes(scope)) return res.status(400).json({ error: 'El alcance de búsqueda no es válido.' });
  if (scope === 'mine' && (typeof req.user?.email !== 'string' || !req.user.email.trim())) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }
  if (casoId !== null && (!Number.isSafeInteger(casoId) || casoId <= 0)) {
    return res.status(400).json({ error: 'El caso_id debe ser un ID numérico válido.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_tickets', {
      p_servicio: 'DEGRA',
      p_busqueda: search || 'All',
      p_fecha_desde: null,
      p_fecha_hasta: null,
      p_lider: null
    });
    if (error) {
      console.error('Error al obtener tickets de Degra:', error);
      return res.status(500).json({ error: 'No se pudieron obtener los tickets de Degra.' });
    }
    if (!Array.isArray(data)) {
      console.error('obtener_tickets no devolvió una lista para Degra.');
      return res.status(502).json({ error: 'La respuesta de tickets de Degra no tiene el formato esperado.' });
    }
    if (data.some((ticket) => !ticket || typeof ticket !== 'object' || Array.isArray(ticket))) {
      console.error('obtener_tickets_degra devolvió un ticket con formato inválido.');
      return res.status(502).json({ error: 'La respuesta contiene tickets de Degra con formato inválido.' });
    }

    let tickets = data;
    if (scope === 'mine') {
      const email = req.user.email.trim().toLowerCase();
      tickets = tickets.filter((ticket) => String(ticket.email || '').trim().toLowerCase() === email);
    }
    if (casoId !== null) tickets = tickets.filter((ticket) => Number(ticket.id) === casoId);

    const ticketsWithImageUrls = await Promise.all(tickets.map(async (ticket) => {
      const images = Array.isArray(ticket.imagenes) ? ticket.imagenes : [];
      const signedImages = await Promise.all(images.map(async (image) => {
        if (!image || typeof image !== 'object' || Array.isArray(image)) {
          throw new Error(`Una imagen del ticket ${ticket.id} no tiene el formato esperado.`);
        }
        const { data: urlData, error: urlError } = await supabase.storage
          .from('ticketera-imagenes')
          .createSignedUrl(image.ruta_archivo, 3600);
        if (urlError) {
          console.error(`Error al generar URL de imagen ${image.id} del ticket de Degra:`, urlError);
          return { ...image, url: null };
        }
        return { ...image, url: urlData.signedUrl };
      }));
      return {
        ...ticket,
        tipo_reg: ticket.tipo_reg || 'TICKET',
        tipo_ticketera: 4,
        observaciones: Array.isArray(ticket.observaciones) ? ticket.observaciones : [],
        imagenes: signedImages
      };
    }));

    return res.json(ticketsWithImageUrls);
  } catch (error) {
    console.error('Error inesperado al obtener tickets de Degra:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.patch('/actualizarEstadoTicketeraDegra', requireDegraTool, async (req, res) => {
  const allowAnyProfileForTesting = process.env.TICKETERA_ALLOW_ANY_PROFILE === 'true';
  if (!allowAnyProfileForTesting && !hasBackOfficeAccess(req.user)) {
    return res.status(403).json({
      error: 'Solo los perfiles de Back Office o Desarrollo pueden actualizar tickets de Degra.'
    });
  }

  const casoId = Number(req.body?.caso_id);
  const estado = typeof req.body?.estado === 'string' ? req.body.estado.trim() : '';
  const observacion = typeof req.body?.observacion === 'string' ? req.body.observacion.trim() : '';
  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    return res.status(400).json({ error: 'El caso_id debe ser un ID numérico válido.' });
  }
  if (!ALLOWED_STATUSES.has(estado)) {
    return res.status(400).json({ error: 'Seleccioná un estado válido para Degra.' });
  }
  if (!observacion || observacion.length > 500) {
    return res.status(400).json({ error: 'La observación es obligatoria y no puede superar los 500 caracteres.' });
  }
  const numeroIt = req.body?.numero_it === undefined || req.body?.numero_it === null
    ? null
    : typeof req.body.numero_it === 'string'
      ? req.body.numero_it.trim() || null
      : undefined;
  if (numeroIt === undefined || (numeroIt && numeroIt.length > 100)) {
    return res.status(400).json({ error: 'El número de IT debe ser texto y no puede superar los 100 caracteres.' });
  }

  try {
    const { data: caso, error: caseError } = await supabase.schema('tickets_soporte')
      .from('ticketera_casos')
      .select('id')
      .eq('id', casoId)
      .eq('tipo_reg', 'TICKET')
      .eq('tipo_ticketera', 4)
      .maybeSingle();
    if (caseError) throw caseError;
    if (!caso) return res.status(404).json({ error: 'El caso no existe o no pertenece a la ticketera de Degra.' });

    const { data, error } = await supabase.rpc('actualizar_estado_ticketera', {
      p_caso_id: casoId,
      p_estado: estado,
      p_observacion: observacion,
      p_email: typeof req.user?.email === 'string' ? req.user.email.trim() : null,
      p_numero_it: numeroIt
    });
    if (error) {
      console.error('Error al actualizar ticket de Degra:', error);
      if (error.message?.includes('No existe un caso')) {
        return res.status(404).json({ error: 'El caso no existe o no pertenece a la ticketera de Degra.' });
      }
      return res.status(500).json({ error: 'No se pudo actualizar el ticket de Degra.' });
    }
    return res.json(data);
  } catch (error) {
    console.error('Error inesperado al actualizar ticket de Degra:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
