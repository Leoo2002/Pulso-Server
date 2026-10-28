const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { supabase } = require('../config/database');
const { canUseTicketing, hasBackOfficeAccess, roleCode } = require('../utils/ticket-access');
const { requireTicketeraAccess, hasTicketeraAccess } = require('../middlewares/ticketera-access');

const router = express.Router();
const BUCKET = 'pulso-ticket-attachments';
const PAGE_SIZE = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_STATUSES = new Set([
  'en_curso',
  'resuelto',
  'cancelado',
  'mal_cargado',
  'pendiente',
  'cancelado_duplicado',
  'cancelado_no_corresponde'
]);
const ALLOWED_TYPES = new Set(['ticket', 'itracker']);
const ALLOWED_SALES_STATUSES = new Set([
  'reportado',
  'cerrado ok',
  'no corresponde',
  'no corresponde duplicado',
  'derivacion incorrecta'
]);
const ALLOWED_TICKETERAS = new Set(['ONBOARDING', 'VENTAS', 'DEGRA']);
const ALLOWED_PRIORITIES = new Set(['baja', 'media', 'alta', 'urgente']);
const ALLOWED_TICKET_USERS = new Set(['U 1', 'U 2', 'U 3', 'U 4', 'U 5', 'U 6']);
const ALLOWED_CHANNELS = new Set(['digital', 'telefonico']);
const ALLOWED_CUSTOMER_TYPES = new Set(['movil', 'hogar', 'smartphone', 'unificado']);
const ALLOWED_MOTIVES = new Set(['delivery', 'mala gestion de venta', 'rellamadores', 'ESim', 'retencion']);
const ALLOWED_IT_TYPES = new Set(['etracker', 'ticky']);
const ALLOWED_IT_MOTIVES = new Set([
  'Smarthome',
  'App Mi Personal',
  'App Flow / Flow App',
  'Inconveniente con CDO',
  'Edificio sin Armar',
  'Gestión de Cita / Adelantamiento',
  'Factibilidad Técnica',
  'Promo no Aplicada / Asignación de Promo',
  'Reintegros / Ajuste NCL / NCL',
  'Cliente Incomunicado',
  'Desconocimiento Hogar',
  'Nominación',
  'Otros (especificar en comentario)'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fields: 20, fieldSize: 20000, files: 3, fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
    }
    callback(null, true);
  }
});

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireTicketAccess(req, res, next) {
  if (!canUseTicketing(req.user)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a la ticketera.' });
  }
  next();
}

function uploadImages(req, res, next) {
  upload.array('images', 3)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: 'Cada imagen puede pesar hasta 5 MB.',
        LIMIT_FILE_COUNT: 'Puedes adjuntar hasta 3 imágenes por ticket.',
        LIMIT_FIELD_COUNT: 'El formulario contiene demasiados campos.',
        LIMIT_FIELD_VALUE: 'Uno de los campos supera el tamaño permitido.'
      };
      const message = messages[error.code] || 'No se pudieron procesar las imágenes adjuntas.';
      return res.status(400).json({ error: message });
    }
    return res.status(400).json({ error: error.message || 'No se pudieron procesar las imágenes.' });
  });
}

function hasValidImageSignature(file) {
  const buffer = file.buffer;
  if (file.mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function escapeSearch(value) {
  return value.replace(/[^a-zA-Z0-9À-ÿ_@. -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toClientTicket(ticket, includeDetails = false) {
  const result = {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    type: ticket.type,
    userCode: ticket.user_code ?? null,
    reporterName: ticket.reporter_name || ticket.requester_name,
    leaderDni: ticket.leader_dni ?? null,
    leaderName: ticket.leader_name ?? null,
    incidentDate: ticket.incident_date ?? null,
    channel: ticket.channel ?? null,
    customerType: ticket.customer_type ?? null,
    customerDni: ticket.customer_dni ?? null,
    contactPhone: ticket.contact_phone ?? null,
    customerEmail: ticket.customer_email ?? null,
    accountNumber: ticket.account_number ?? null,
    orderNumber: ticket.order_number ?? null,
    motive: ticket.motive ?? null,
    submotive: ticket.submotive ?? null,
    comment: ticket.comment ?? null,
    itType: ticket.it_type ?? null,
    managementNumber: ticket.management_number ?? null,
    itMotive: ticket.it_motive ?? null,
    subject: ticket.subject || ticket.it_motive || ticket.motive || 'Solicitud de soporte',
    category: ticket.category || ticket.channel || 'Soporte',
    priority: ticket.priority ?? null,
    status: ticket.status,
    requesterName: ticket.requester_name,
    requesterEmail: ticket.requester_email,
    requesterSegment: ticket.requester_segment,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at
  };
  if (includeDetails) {
    result.description = ticket.comment || ticket.description || '';
    result.observation = ticket.observation;
    result.attachments = ticket.attachments;
  }
  return result;
}

async function signAttachments(attachments) {
  return Promise.all((attachments || []).map(async (attachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(attachment.path, 300);
    if (error) throw error;
    return { ...attachment, url: data.signedUrl };
  }));
}

router.use('/tickets', requireTicketAccess, requireTicketeraAccess('ONBOARDING'));
router.use('/obtenerTickets', requireTicketAccess, requireTicketeraAccess());

router.get('/tickets/summary', async (_req, res) => {
  try {
    const types = ['TICKET', 'ITRACKER'];
    const queries = types.map((type) => (
      supabase.schema('tickets_soporte')
        .from('ticketera_casos')
        .select('id', { count: 'exact', head: true })
        .eq('tipo_ticketera', 3)
        .eq('tipo_reg', type)
    ));
    const results = await Promise.all(queries);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;

    const summary = {
      ticket: { total: results[0].count || 0 },
      itracker: { total: results[1].count || 0 }
    };
    res.json(summary);
  } catch (error) {
    console.error('Error al obtener el resumen de tickets:', error);
    res.status(500).json({ error: 'No se pudo cargar el resumen de tickets.' });
  }
});

router.get('/tickets/statistics', async (req, res) => {
  // La RPC historica agrega todas las ticketeras y no admite un alcance.
  if (!['ONBOARDING', 'VENTAS', 'DEGRA'].every((name) => hasTicketeraAccess(req, name))) {
    return res.status(403).json({ error: 'Las estadisticas globales requieren acceso a todas las ticketeras. Usa la analitica de ONBOARDING.' });
  }
  try {
    const { data, error } = await supabase.rpc('obtener_estadisticas_ticketera');
    if (error) {
      console.error('Error al obtener las estadísticas de Ticketera:', error);
      return res.status(500).json({ error: 'No se pudieron cargar las estadísticas de Ticketera.' });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      console.error('La función obtener_estadisticas_ticketera devolvió una respuesta inválida.');
      return res.status(502).json({ error: 'La respuesta de estadísticas no tiene el formato esperado.' });
    }

    const requiredArrays = ['general', 'tickets', 'it', 'por_lider', 'por_canal', 'por_motivo'];
    if (requiredArrays.some((key) => !Array.isArray(data[key]))) {
      console.error('La función obtener_estadisticas_ticketera no devolvió todas las listas esperadas.');
      return res.status(502).json({ error: 'La respuesta de estadísticas está incompleta.' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error inesperado al obtener las estadísticas de Ticketera:', error);
    return res.status(500).json({ error: 'No se pudieron cargar las estadísticas de Ticketera.' });
  }
});

router.get('/tickets', async (req, res) => {
  const page = Math.max(1, Math.min(Number.parseInt(req.query.page, 10) || 1, 10000));
  const type = req.query.type;
  const status = req.query.status;
  const userCode = req.query.userCode;
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const search = typeof req.query.q === 'string' ? escapeSearch(req.query.q) : '';

  if (type && !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: 'El tipo de solicitud no es válido.' });
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'El estado del ticket no es válido.' });
  }
  if (userCode && !ALLOWED_TICKET_USERS.has(userCode) && !/^U\d{6}$/.test(userCode)) {
    return res.status(400).json({ error: 'El usuario del ticket no es válido.' });
  }
  if (dateFrom && !isValidDate(dateFrom)) {
    return res.status(400).json({ error: 'La fecha inicial no es válida.' });
  }
  if (dateTo && !isValidDate(dateTo)) {
    return res.status(400).json({ error: 'La fecha final no es válida.' });
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'La fecha inicial no puede ser posterior a la fecha final.' });
  }

  try {
    let query = supabase.from('support_tickets')
      .select('id,ticket_number,type,user_code,subject,category,priority,status,requester_name,requester_email,requester_segment,reporter_name,leader_dni,leader_name,incident_date,channel,customer_type,customer_dni,contact_phone,customer_email,account_number,order_number,motive,submotive,comment,uteco,it_type,management_number,it_motive,created_at,updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (userCode) query = query.eq('user_code', userCode);
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00-03:00`);
    if (dateTo) {
      const exclusiveEnd = new Date(`${dateTo}T00:00:00Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      query = query.lt('created_at', `${exclusiveEnd.toISOString().slice(0, 10)}T00:00:00-03:00`);
    }
    if (search) {
      const pattern = `%${search}%`;
      const ticketNumber = /^\d{1,12}$/.test(search) ? Number(search) : null;
      const conditions = [
        `subject.ilike.${pattern}`,
        `description.ilike.${pattern}`,
        `category.ilike.${pattern}`,
        `requester_name.ilike.${pattern}`,
        `requester_email.ilike.${pattern}`,
        `leader_name.ilike.${pattern}`,
        `customer_dni.ilike.${pattern}`,
        `contact_phone.ilike.${pattern}`,
        `customer_email.ilike.${pattern}`,
        `account_number.ilike.${pattern}`,
        `order_number.ilike.${pattern}`,
        `motive.ilike.${pattern}`,
        `submotive.ilike.${pattern}`,
        `comment.ilike.${pattern}`,
        `uteco.ilike.${pattern}`,
        `it_type.ilike.${pattern}`,
        `management_number.ilike.${pattern}`,
        `it_motive.ilike.${pattern}`
      ];
      if (ticketNumber !== null) conditions.unshift(`ticket_number.eq.${ticketNumber}`);
      query = query.or(conditions.join(','));
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ items: (data || []).map((ticket) => toClientTicket(ticket)), total: count || 0, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('Error al buscar tickets:', error);
    res.status(500).json({ error: 'No se pudieron cargar los tickets.' });
  }
});

router.get('/tickets/:id/attachments/:index/download', async (req, res) => {
  if (!validUuid(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del ticket no es válido.' });
  }
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0 || index > 2) {
    return res.status(400).json({ error: 'El adjunto solicitado no es válido.' });
  }

  try {
    const { data: ticket, error: ticketError } = await supabase.from('support_tickets')
      .select('attachments')
      .eq('id', req.params.id)
      .single();
    if (ticketError) {
      if (ticketError.code === 'PGRST116') return res.status(404).json({ error: 'No se encontró el ticket solicitado.' });
      throw ticketError;
    }

    const attachment = ticket.attachments?.[index];
    if (!attachment) return res.status(404).json({ error: 'No se encontró la imagen solicitada.' });

    const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(attachment.path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await file.arrayBuffer());
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(buffer);
  } catch (error) {
    console.error('Error al descargar la imagen del ticket:', error);
    res.status(500).json({ error: 'No se pudo descargar la imagen.' });
  }
});

router.get('/tickets/:id', async (req, res) => {
  if (!validUuid(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del ticket no es válido.' });
  }

  try {
    const { data, error } = await supabase.from('support_tickets')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'No se encontró el ticket solicitado.' });
      throw error;
    }
    const attachments = await signAttachments(data.attachments);
    res.json(toClientTicket({ ...data, attachments }, true));
  } catch (error) {
    console.error('Error al obtener el detalle del ticket:', error);
    res.status(500).json({ error: 'No se pudo cargar el detalle del ticket.' });
  }
});

router.post('/tickets', uploadImages, async (req, res) => {
  const { type, userCode, subject, category, priority, description } = req.body;
  const field = (key) => typeof req.body?.[key] === 'string' ? req.body[key].trim() : '';
  const normalized = {
    type: typeof type === 'string' ? type.trim().toLowerCase() : '',
    userCode: typeof userCode === 'string' ? userCode.trim() : '',
    subject: typeof subject === 'string' ? subject.trim() : '',
    category: typeof category === 'string' ? category.trim() : '',
    priority: typeof priority === 'string' ? priority.trim().toLowerCase() : '',
    description: typeof description === 'string' ? description.trim() : '',
    leaderDni: field('leaderDni'),
    incidentDate: field('incidentDate'),
    channel: field('channel'),
    customerType: field('customerType'),
    customerDni: field('customerDni'),
    contactPhone: field('contactPhone'),
    customerEmail: field('customerEmail').toLowerCase(),
    accountNumber: field('accountNumber'),
    orderNumber: field('orderNumber'),
    motive: field('motive'),
    submotive: field('submotive'),
    comment: field('comment'),
    itType: field('itType').toLowerCase(),
    managementNumber: field('managementNumber'),
    itMotive: field('itMotive'),
  };

  if (!ALLOWED_TYPES.has(normalized.type)) return res.status(400).json({ error: 'Selecciona Ticket o ITracker.' });
  if (normalized.type === 'ticket' && !/^U\d{6}$/.test(normalized.userCode)) {
    return res.status(400).json({ error: 'El usuario debe tener el formato U123456.' });
  }
  if (normalized.type === 'ticket') {
    if (!/^\d{6,12}$/.test(normalized.leaderDni)) return res.status(400).json({ error: 'Selecciona un líder válido.' });
    if (!isValidDate(normalized.incidentDate)) return res.status(400).json({ error: 'La fecha del inconveniente no es válida.' });
    if (!ALLOWED_CHANNELS.has(normalized.channel)) return res.status(400).json({ error: 'Selecciona un canal válido.' });
    if (!ALLOWED_CUSTOMER_TYPES.has(normalized.customerType)) return res.status(400).json({ error: 'Selecciona un tipo de cliente válido.' });
    if (!/^\d{6,12}$/.test(normalized.customerDni)) return res.status(400).json({ error: 'El DNI del cliente debe contener entre 6 y 12 dígitos.' });
    if (!ALLOWED_MOTIVES.has(normalized.motive)) return res.status(400).json({ error: 'Selecciona un motivo válido.' });
    if (normalized.contactPhone && (!/^[+0-9() -]{7,30}$/.test(normalized.contactPhone))) {
      return res.status(400).json({ error: 'El teléfono de contacto no es válido.' });
    }
    if (normalized.customerEmail && (normalized.customerEmail.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.customerEmail))) {
      return res.status(400).json({ error: 'El email del cliente no es válido.' });
    }
    if (normalized.accountNumber.length > 80 || normalized.orderNumber.length > 80) {
      return res.status(400).json({ error: 'El número de cuenta y pedido no pueden superar los 80 caracteres.' });
    }
    if (normalized.submotive.length > 150) return res.status(400).json({ error: 'El submotivo no puede superar los 150 caracteres.' });
    if (normalized.comment.length > 5000) return res.status(400).json({ error: 'El comentario no puede superar los 5000 caracteres.' });
  } else {
    if (!/^U\d{6}$/.test(normalized.userCode)) return res.status(400).json({ error: 'El usuario debe tener el formato U123456.' });
    if (!/^\d{6,12}$/.test(normalized.leaderDni)) return res.status(400).json({ error: 'Selecciona un líder que valide el caso.' });
    if (!ALLOWED_CHANNELS.has(normalized.channel)) return res.status(400).json({ error: 'Selecciona un canal válido.' });
    if (!ALLOWED_IT_TYPES.has(normalized.itType)) return res.status(400).json({ error: 'Selecciona un tipo de IT válido.' });
    if (!isValidDate(normalized.incidentDate)) return res.status(400).json({ error: 'La fecha del inconveniente no es válida.' });
    if (!ALLOWED_IT_MOTIVES.has(normalized.itMotive)) return res.status(400).json({ error: 'Selecciona un motivo de IT válido.' });
    if (!/^[+0-9() -]{7,30}$/.test(normalized.contactPhone)) return res.status(400).json({ error: 'El teléfono de contacto no es válido.' });
    if (normalized.customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.customerEmail)) {
      return res.status(400).json({ error: 'El email del cliente no es válido.' });
    }
    if (normalized.managementNumber.length > 80) return res.status(400).json({ error: 'El número de gestión no puede superar los 80 caracteres.' });
    if (normalized.subject.length < 3 || normalized.subject.length > 150) return res.status(400).json({ error: 'El asunto debe tener entre 3 y 150 caracteres.' });
    if (normalized.category.length < 2 || normalized.category.length > 80) return res.status(400).json({ error: 'La categoría debe tener entre 2 y 80 caracteres.' });
    if (!ALLOWED_PRIORITIES.has(normalized.priority)) return res.status(400).json({ error: 'Selecciona una prioridad válida.' });
    if (normalized.description.length < 10 || normalized.description.length > 5000) return res.status(400).json({ error: 'La descripción debe tener entre 10 y 5000 caracteres.' });
  }
  if (!req.user?.email) return res.status(401).json({ error: 'No se pudo identificar al usuario solicitante.' });

  const requesterName = String(req.user.name || [req.user.given_name, req.user.family_name].filter(Boolean).join(' ') || '').trim();
  if (!requesterName) return res.status(400).json({ error: 'El token de acceso no contiene el nombre completo del usuario.' });
  const uploadedPaths = [];
  const attachments = [];

  try {
    let leader = null;
    if (normalized.type === 'ticket' || normalized.type === 'itracker') {
      const { data, error } = await supabase.from('lideres')
        .select('nombre,dni_lider')
        .eq('dni_lider', Number(normalized.leaderDni))
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(400).json({ error: 'El líder seleccionado ya no está disponible.' });
      leader = data;
    }

    if ((req.files || []).some((file) => !hasValidImageSignature(file))) {
      return res.status(400).json({ error: 'Una imagen adjunta no tiene un formato válido.' });
    }
    if (normalized.type === 'itracker') {
      if ((req.files || []).some((file) => !['image/jpeg', 'image/png'].includes(file.mimetype))) {
        return res.status(400).json({ error: 'iTracker solo admite imágenes JPG o PNG.' });
      }
      if ((req.files || []).reduce((total, file) => total + file.size, 0) > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'El tamaño total de las imágenes no puede superar 5 MB.' });
      }
    }

    const ticketId = crypto.randomUUID();
    for (const file of req.files || []) {
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.mimetype];
      const path = `${ticketId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });
      if (error) throw error;
      uploadedPaths.push(path);
      attachments.push({
        path,
        name: file.originalname.replace(/[\\/]/g, '_').slice(0, 150),
        contentType: file.mimetype,
        size: file.size
      });
    }

    const { data, error } = await supabase.from('support_tickets').insert({
      id: ticketId,
      type: normalized.type,
      user_code: normalized.userCode || null,
      subject: normalized.type === 'ticket' ? normalized.motive : null,
      category: normalized.type === 'ticket' ? normalized.channel : normalized.category,
      priority: normalized.type === 'ticket' ? 'media' : null,
      description: normalized.type === 'ticket' ? null : normalized.description,
      requester_email: String(req.user.email).trim().toLowerCase(),
      requester_name: requesterName || String(req.user.email).trim(),
      reporter_name: requesterName,
      requester_role: roleCode(req.user.rol),
      requester_segment: String(req.user.segmento || ''),
      leader_dni: leader ? String(leader.dni_lider) : null,
      leader_name: leader?.nombre || null,
      incident_date: normalized.incidentDate || null,
      channel: normalized.channel,
      customer_type: normalized.type === 'ticket' ? normalized.customerType : null,
      customer_dni: normalized.type === 'ticket' ? normalized.customerDni : null,
      contact_phone: normalized.contactPhone || null,
      customer_email: normalized.customerEmail || null,
      account_number: normalized.type === 'ticket' ? normalized.accountNumber || null : null,
      order_number: normalized.type === 'ticket' ? normalized.orderNumber || null : null,
      motive: normalized.type === 'ticket' ? normalized.motive : null,
      submotive: normalized.type === 'ticket' ? normalized.submotive || null : null,
      comment: normalized.type === 'ticket' ? normalized.comment || null : null,
      it_type: normalized.type === 'itracker' ? normalized.itType : null,
      management_number: normalized.type === 'itracker' ? normalized.managementNumber || null : null,
      it_motive: normalized.type === 'itracker' ? normalized.itMotive : null,
      attachments
    }).select('id,ticket_number,type,user_code,subject,category,priority,status,requester_name,requester_email,requester_segment,reporter_name,leader_dni,leader_name,incident_date,channel,customer_type,customer_dni,contact_phone,customer_email,account_number,order_number,motive,submotive,comment,uteco,it_type,management_number,it_motive,created_at,updated_at').single();

    if (error) throw error;
    res.status(201).json(toClientTicket(data));
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(uploadedPaths);
      if (cleanupError) console.error('No se pudieron limpiar adjuntos tras fallar la creación del ticket:', cleanupError);
    }
    console.error('Error al crear ticket:', error);
    res.status(500).json({ error: 'No se pudo crear el ticket. Inténtalo nuevamente.' });
  }
});

router.patch('/tickets/:id/state', async (req, res) => {
  if (!hasBackOfficeAccess(req.user)) {
    return res.status(403).json({ error: 'Solo perfiles de Back Office pueden gestionar tickets.' });
  }
  if (!validUuid(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del ticket no es válido.' });
  }

  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  const observation = typeof req.body?.observation === 'string' ? req.body.observation.trim() : '';
  if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: 'Selecciona un estado válido.' });
  if (observation.length > 500) return res.status(400).json({ error: 'La observación no puede superar los 500 caracteres.' });

  try {
    const { data, error } = await supabase.from('support_tickets')
      .update({ status, observation, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id,status,observation,updated_at')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'No se encontró el ticket solicitado.' });
      throw error;
    }
    res.json({
      id: data.id,
      status: data.status,
      observation: data.observation,
      updatedAt: data.updated_at
    });
  } catch (error) {
    console.error('Error al actualizar el estado del ticket:', error);
    res.status(500).json({ error: 'No se pudo actualizar el ticket.' });
  }
});



router.get('/obtenerTickets', async (req, res) => {
  const search = typeof req.query.p_busqueda === 'string' ? req.query.p_busqueda.trim() : 'All';
  const rawTicketera = typeof req.query.servicio === 'string' ? req.query.servicio.trim().toUpperCase() : '';
  const ticketera = ['ABONO/DEGRA', 'ABONO-DEGRA'].includes(rawTicketera) ? 'DEGRA' : rawTicketera;
  const scope = typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : 'all';
  const type = typeof req.query.type === 'string' ? req.query.type.trim().toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const userCode = typeof req.query.userCode === 'string' ? req.query.userCode.trim().toLowerCase() : '';
  const leader = typeof req.query.lider === 'string' ? req.query.lider.trim() : '';
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';

  if (!ALLOWED_TICKETERAS.has(ticketera)) {
    return res.status(400).json({ error: 'El servicio de Ticketera no es válido.' });
  }
  if (!hasTicketeraAccess(req, ticketera)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a esta ticketera.' });
  }
  if (search.length > 100) {
    return res.status(400).json({ error: 'La búsqueda no puede superar los 100 caracteres.' });
  }
  if (req.query.lider !== undefined && typeof req.query.lider !== 'string') {
    return res.status(400).json({ error: 'El líder debe ser texto.' });
  }
  if (leader.length > 150) {
    return res.status(400).json({ error: 'El líder no puede superar los 150 caracteres.' });
  }
  if (!['all', 'mine'].includes(scope)) {
    return res.status(400).json({ error: 'El alcance de búsqueda no es válido.' });
  }
  if (scope === 'mine' && !req.user?.email) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }
  const requesterEmail = scope === 'mine'
    ? String(req.user.email).trim().toLowerCase()
    : '';
  if (type && !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: 'El tipo de solicitud no es válido.' });
  }
  const normalizeStatus = (value) => value.trim().toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  const statusFilter = normalizeStatus(status);
  const searchableStatuses = ticketera === 'VENTAS'
    ? new Set([...ALLOWED_SALES_STATUSES].map(normalizeStatus))
    : new Set([...ALLOWED_STATUSES, ...(ticketera === 'ONBOARDING' ? ['pendiente_bo'] : [])]
      .map(normalizeStatus));
  if (status && !searchableStatuses.has(statusFilter)) {
    return res.status(400).json({ error: 'El estado del ticket no es válido.' });
  }
  if (userCode && ticketera !== 'ONBOARDING') {
    return res.status(400).json({ error: 'El filtro de usuario solo está disponible para ONBOARDING.' });
  }
  if (userCode && !ALLOWED_TICKET_USERS.has(userCode.toUpperCase()) && !/^u\d{6}$/i.test(userCode)) {
    return res.status(400).json({ error: 'El usuario del ticket no es válido.' });
  }
  if (dateFrom && !isValidDate(dateFrom)) {
    return res.status(400).json({ error: 'La fecha inicial no es válida.' });
  }
  if (dateTo && !isValidDate(dateTo)) {
    return res.status(400).json({ error: 'La fecha final no es válida.' });
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'La fecha inicial no puede ser posterior a la fecha final.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_tickets', {
      p_servicio: ticketera,
      p_busqueda: search || 'All',
      p_fecha_desde: dateFrom || null,
      p_fecha_hasta: dateTo || null,
      p_lider: leader || null
    });
    if (error) {
      console.error('Error al obtener tickets:', error);
      return res.status(500).json({
        error: 'No se pudieron obtener los tickets.'
      });
    }

    if (!Array.isArray(data)) {
      console.error('La función obtener_tickets no devolvió una lista.');
      return res.status(502).json({ error: 'La respuesta de tickets no tiene el formato esperado.' });
    }

    if (data.some((ticket) => !ticket || typeof ticket !== 'object' || Array.isArray(ticket))) {
      console.error('obtener_tickets devolvió un ticket con formato inválido.');
      return res.status(502).json({ error: 'La respuesta contiene tickets con formato inválido.' });
    }

    const userEmail = requesterEmail;
    const filteredTickets = data.filter((ticket) => {
      if (userEmail && String(ticket.email || '').trim().toLowerCase() !== userEmail) return false;
      const rawType = String(ticket.tipo_reg || ticket.type || ticket.tipo || '').trim().toLowerCase();
      const ticketType = rawType === 'it' ? 'itracker' : rawType;
      if (type && ticketType !== type) return false;
      const rawStatus = String(ticket.estado_actual || ticket.estado || ticket.status || '');
      const normalizedStatus = normalizeStatus(rawStatus);
      const statusAliases = {
        en_gestion: 'en_curso',
        pendiente_de_bo: 'pendiente_bo'
      };
      if (status && (statusAliases[normalizedStatus] || normalizedStatus) !== statusFilter) return false;
      const code = String(ticket.usuario || ticket.user_code || ticket.usuario_u_teco || ticket.uteco || '')
        .trim()
        .toLowerCase();
      if (userCode && code !== userCode) return false;
      return true;
    });

    const ticketsWithImageUrls = await Promise.all(filteredTickets.map(async (ticket) => {
      const images = Array.isArray(ticket.imagenes) ? ticket.imagenes : [];
      const signedImages = await Promise.all(images.map(async (image) => {
        if (!image || typeof image !== 'object' || Array.isArray(image)) {
          throw new Error(`Una imagen del ticket ${ticket.id} no tiene el formato esperado.`);
        }
        const { data: urlData, error: urlError } = await supabase.storage
          .from('ticketera-imagenes')
          .createSignedUrl(image.ruta_archivo, 3600);
        if (urlError) {
          console.error(`Error al generar URL de imagen ${image.id}:`, urlError);
          return { ...image, url: null };
        }
        return { ...image, url: urlData.signedUrl };
      }));
      return {
        ...ticket,
        tipo_reg: ticket.tipo_reg || 'TICKET',
        tipo_ticketera: ticket.tipo_ticketera || (
          ticketera === 'VENTAS' ? 2 : ticketera === 'DEGRA' ? 4 : 3
        ),
        observaciones: Array.isArray(ticket.observaciones) ? ticket.observaciones : [],
        imagenes: signedImages
      };
    }));

    return res.json(ticketsWithImageUrls);
  } catch (error) {
    console.error('Error inesperado al obtener tickets:', error);

    return res.status(500).json({
      error: 'Error interno del servidor.'
    });
  }
});


module.exports = router;
