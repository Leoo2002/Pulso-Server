
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const {
  hasBackOfficeAccess, authorizeTicketSearch, defaultTicketDates, ticketPermissions, ticketMatchesSearch
} = require('../utils/ticket-access');
const {
  requireTicketeraAccess,
  hasTicketeraAccess,
  normalizeTicketera,
  requireTicketeraCase
} = require('../middlewares/ticketera-access');
const { createTicketeraCase } = require('../services/ticketera-create.service');
const { optimizeImage, ImageValidationError } = require('../utils/optimize-image');

router.use(['/crearTicketeraTicket', '/crearIT', '/actualizarEstadoTicketera', '/lideresTck'],
  requireTicketeraAccess('ONBOARDING'));
router.use(['/crearTicketeraTicketVentas', '/obtenerTicketsVentas', '/actualizarEstadoTicketeraVentas'],
  requireTicketeraAccess('VENTAS'));
router.use(['/crearTicketera', '/subirImagenesTicketera', '/lideresTicketera'], requireTicketeraAccess());

const multer = require('multer');
const path = require('path');


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB por imagen
    files: 3,
    fields: 2,
    fieldSize: 10 * 1024
  },
  fileFilter: (req, file, cb) => {
    const permitidos = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!permitidos.includes(file.mimetype)) {
      return cb(
        new Error('Solo se permiten imágenes JPEG, PNG o WebP.')
      );
    }

    cb(null, true);
  }
});
const MAX_IT_IMAGES_SIZE = 5 * 1024 * 1024;
const ESTADOS_TICKETERA = new Set([
  'En gestión',
  'Reportado',
  'Resuelto',
  'Cancelado Duplicado',
  'Cancelado No Corresponde'
]);
const ESTADOS_TICKETERA_VENTAS = new Set([
  'Reportado',
  'Cerrado OK',
  'No corresponde',
  'No corresponde duplicado',
  'Derivación incorrecta'
]);
const LIDERES_TICKETERAS = new Set(['VENTAS', 'ONBOARDING', 'ABONO/DEGRA']);

function validateCreatePayload(service, ticket) {
  const salesRequired = [
    'usuario_teco', 'nombre', 'lider', 'canal', 'tipo_venta', 'motivo',
    'submotivo', 'numero_gestion', 'dni_cliente', 'telefono_contacto', 'comentario_carga'
  ];
  const degraRequired = [
    'canal', 'usuario', 'nombre', 'requiere_contacto', 'lider', 'site_ubicacion',
    'especialidad', 'tipo_reclamo_circuito', 'motivo_principal', 'submotivo',
    'linea_msisdn', 'detalle_observacion'
  ];
  const required = service === 'VENTAS' ? salesRequired : service === 'DEGRA' ? degraRequired : [];
  if (required.some((field) => typeof ticket[field] !== 'string' || !ticket[field].trim())) {
    return `Completá todos los campos obligatorios del ticket de ${service}.`;
  }
  const maxLengths = service === 'VENTAS'
    ? {
      usuario_teco: 80, nombre: 150, lider: 150, canal: 120, tipo_venta: 120,
      motivo: 150, submotivo: 150, numero_gestion: 80, dni_cliente: 12,
      telefono_contacto: 30, comentario_carga: 5000, email_cliente: 254
    }
    : service === 'DEGRA'
      ? {
        canal: 120, usuario: 80, nombre: 150, lider: 150, site_ubicacion: 150,
        especialidad: 150, telefono_contacto: 30, email_cliente: 254,
        tipo_reclamo_circuito: 150, motivo_principal: 150, submotivo: 150,
        numero_caso: 80, linea_msisdn: 40, detalle_observacion: 5000
      }
      : {};
  const invalidField = Object.entries(maxLengths).find(([field, maxLength]) =>
    ticket[field] !== undefined
    && ticket[field] !== null
    && (typeof ticket[field] !== 'string' || ticket[field].length > maxLength)
  );
  if (invalidField) return `Revisá el formato o el largo del campo ${invalidField[0]}.`;
  if (ticket.email_cliente !== undefined && ticket.email_cliente !== null
    && typeof ticket.email_cliente !== 'string') {
    return 'El campo email_cliente debe ser texto.';
  }
  if (service === 'VENTAS') {
    if (!/^[0-9]{6,12}$/.test(ticket.dni_cliente.trim())
      || !/^[+0-9() -]{7,30}$/.test(ticket.telefono_contacto.trim())) {
      return 'Revisá el formato de los datos del ticket de Ventas.';
    }
    if (ticket.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.email_cliente.trim())) {
      return 'Revisá el formato del mail de contacto.';
    }
  }
  if (service === 'DEGRA') {
    const contactRequired = String(ticket.requiere_contacto).trim().toLocaleLowerCase('es');
    if (!['true', 'false', 'si', 'sí', 'no'].includes(contactRequired)) {
      return 'El campo requiere_contacto debe ser Sí o No.';
    }
    if (ticket.telefono_contacto && !/^[+0-9() -]{7,30}$/.test(ticket.telefono_contacto.trim())) {
      return 'Revisá el formato del teléfono de contacto.';
    }
    if (ticket.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.email_cliente.trim())) {
      return 'Revisá el formato del mail de contacto.';
    }
  }
  return '';
}

function receiveCreationImages(req, res, next) {
  upload.array('imagenes', 3)(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message || 'No se pudieron recibir las imagenes.' });
    if (typeof req.body?.ticket === 'string') {
      try {
        req.body.ticket = JSON.parse(req.body.ticket);
      } catch {
        return res.status(400).json({ error: 'Los datos del ticket no contienen JSON valido.' });
      }
    }
    return next();
  });
}

router.post('/crearTicketera', receiveCreationImages, async (req, res) => {
  const service = typeof req.body?.servicio === 'string' ? req.body.servicio.trim().toUpperCase() : '';
  const serviceAliases = { IT: 'IT', ITRACKER: 'IT', ONBO: 'ONBOARDING', 'ABONO/DEGRA': 'DEGRA' };
  const normalizedService = serviceAliases[service] || service;
  const allowedServices = new Set(['ONBOARDING', 'IT', 'SOPORTE', 'TICKET', 'VENTAS', 'DEGRA']);
  const ticket = req.body?.ticket;

  if (!allowedServices.has(normalizedService)) {
    return res.status(400).json({ error: 'El servicio de Ticketera no es válido.' });
  }
  const accessService = ['VENTAS', 'DEGRA'].includes(normalizedService) ? normalizedService : 'ONBOARDING';
  if (!hasTicketeraAccess(req, accessService)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a esta ticketera.' });
  }
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({ error: 'Los datos del ticket son obligatorios.' });
  }
  const creatorEmail = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (!creatorEmail) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }
  const validationError = validateCreatePayload(normalizedService, ticket);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const files = req.files || [];
    if (['IT', 'VENTAS'].includes(normalizedService)
      && files.some((file) => !['image/jpeg', 'image/png'].includes(file.mimetype))) {
      return res.status(400).json({ error: 'ITracker y Ventas solo admiten imagenes JPG o PNG.' });
    }
    if (normalizedService === 'IT'
      && files.reduce((total, file) => total + file.size, 0) > MAX_IT_IMAGES_SIZE) {
      return res.status(400).json({ error: 'El total de imagenes de ITracker no puede superar 5 MB.' });
    }
    req.initialImages = [];
    for (const file of files) req.initialImages.push(await optimizeImage(file));
    const result = await createTicketeraCase(normalizedService, ticket, creatorEmail);
    if (files.length) {
      req.createdTicket = result;
      req.createdTicketera = accessService;
      req.body.caso_id = result.caso_id;
      return saveInitialImages(req, res);
    }
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof ImageValidationError) return res.status(400).json({ error: error.message });
    console.error(`Error al crear ticket de ${normalizedService}:`, error);
    const statusCode = error.code === 'P0001' || error.code === '22007' ? 400 : 500;
    return res.status(statusCode).json({
      error: `No se pudo crear el ticket de ${normalizedService}.`,
      ...(statusCode === 400 ? { detalle: error.message } : {})
    });
  }
});

// Crear un ticket de la ticketera
router.post('/crearTicketeraTicket', async (req, res) => {
  const ticket = req.body?.ticket;

  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({
      error: 'Los datos del ticket son obligatorios.'
    });
  }

  try {
    const result = await createTicketeraCase(
      'ONBOARDING',
      ticket,
      typeof req.user?.email === 'string' ? req.user.email.trim() : ''
    );
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error en el servidor al crear ticket:', error);
    const statusCode = error.code === 'P0001' || error.code === '22007' ? 400 : 500;
    return res.status(statusCode).json({ error: 'No se pudo crear el ticket.', ...(statusCode === 400 ? { detalle: error.message } : {}) });
  }
});

router.post('/crearTicketeraTicketVentas', async (req, res) => {
  const ticket = req.body?.ticket;

  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({
      error: 'Los datos del ticket de Ventas son obligatorios.'
    });
  }
  const creatorEmail = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (!creatorEmail) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }

  const requiredFields = [
    'usuario_teco',
    'nombre',
    'lider',
    'canal',
    'tipo_venta',
    'motivo',
    'submotivo',
    'numero_gestion',
    'dni_cliente',
    'telefono_contacto',
    'comentario_carga'
  ];
  const missingField = requiredFields.find((field) =>
    typeof ticket[field] !== 'string' || !ticket[field].trim()
  );
  if (missingField) {
    return res.status(400).json({
      error: 'Completá todos los campos obligatorios del ticket de Ventas.'
    });
  }

  const maxLengths = {
    usuario_teco: 80,
    nombre: 150,
    lider: 150,
    canal: 120,
    tipo_venta: 120,
    motivo: 150,
    submotivo: 150,
    numero_gestion: 80,
    dni_cliente: 12,
    telefono_contacto: 30,
    comentario_carga: 5000
  };
  const oversizedField = Object.entries(maxLengths).find(([field, maxLength]) =>
    ticket[field].length > maxLength
  );
  if (oversizedField
    || ticket.email_cliente !== undefined
      && (typeof ticket.email_cliente !== 'string'
        || ticket.email_cliente.length > 254
        || ticket.email_cliente && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.email_cliente.trim()))
    || !/^[0-9]{6,12}$/.test(ticket.dni_cliente.trim())
    || !/^[+0-9() -]{7,30}$/.test(ticket.telefono_contacto.trim())) {
    return res.status(400).json({
      error: 'Revisá el formato o el largo de los datos del ticket de Ventas.'
    });
  }

  try {
    const result = await createTicketeraCase('VENTAS', ticket, creatorEmail);
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error en el servidor al crear ticket de Ventas:', error);
    const statusCode = error.code === 'P0001' || error.code === '22007' ? 400 : 500;
    return res.status(statusCode).json({ error: 'No se pudo crear el ticket de Ventas.', ...(statusCode === 400 ? { detalle: error.message } : {}) });
  }
});

router.get('/obtenerTicketsVentas', async (req, res) => {
  const search = typeof req.query.p_busqueda === 'string' ? req.query.p_busqueda.trim() : 'All';
  const scope = typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : 'all';
  if (search.length > 100) {
    return res.status(400).json({ error: 'La búsqueda no puede superar los 100 caracteres.' });
  }
  if (!['all', 'mine'].includes(scope)) {
    return res.status(400).json({ error: 'El alcance de búsqueda no es válido.' });
  }
  if (scope === 'mine' && (typeof req.user?.email !== 'string' || !req.user.email.trim())) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }
  if (!authorizeTicketSearch(req, res, search, scope)) return;

  try {
    const dates = defaultTicketDates(search, scope);
    const { data, error } = await supabase.rpc('obtener_tickets', {
      p_servicio: 'VENTAS',
      p_busqueda: search || 'All',
      p_fecha_desde: dates.from,
      p_fecha_hasta: dates.to,
      p_lider: null
    });
    if (error) {
      console.error('Error al obtener tickets de Ventas:', error);
      return res.status(500).json({ error: 'No se pudieron obtener los tickets de Ventas.' });
    }
    if (!Array.isArray(data)) {
      console.error('La función obtener_tickets no devolvió una lista para Ventas.');
      return res.status(502).json({ error: 'La respuesta de tickets de Ventas no tiene el formato esperado.' });
    }
    if (data.some((ticket) => !ticket || normalizeTicketera(ticket.tipo_ticketera) !== 'VENTAS')) {
      console.error('obtener_tickets devolvio casos fuera de Ventas.');
      return res.status(502).json({ error: 'La respuesta contiene casos fuera de Ventas.' });
    }

    const requesterEmail = scope === 'mine' ? req.user.email.trim().toLowerCase() : '';
    let scopedTickets = scope === 'mine'
      ? data.filter((ticket) =>
        ticket && typeof ticket === 'object' && !Array.isArray(ticket)
        && String(ticket.email || '').trim().toLowerCase() === requesterEmail
      )
      : data;
    if (scope !== 'mine' && !ticketPermissions(req.user).list) {
      scopedTickets = scopedTickets.filter((ticket) => ticketMatchesSearch(ticket, search));
    }

    const tickets = await Promise.all(scopedTickets.map(async (ticket, index) => {
      if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
        throw new Error(`El registro de Ventas ${index + 1} no tiene el formato esperado.`);
      }
      const imagenes = await Promise.all((Array.isArray(ticket.imagenes) ? ticket.imagenes : []).map(async (image) => {
        if (!image || typeof image !== 'object' || Array.isArray(image)) {
          throw new Error(`Una imagen del ticket ${ticket.id} no tiene el formato esperado.`);
        }
        const { data: urlData, error: urlError } = await supabase.storage
          .from('ticketera-imagenes')
          .createSignedUrl(image.ruta_archivo, 3600);
        if (urlError) {
          console.error(`Error al generar URL de imagen ${image.id} del ticket de Ventas:`, urlError);
          return { ...image, url: null };
        }
        return { ...image, url: urlData.signedUrl };
      }));
      return {
        ...ticket,
        tipo_reg: ticket.tipo_reg || 'TICKET',
        tipo_ticketera: ticket.tipo_ticketera || 2,
        observaciones: Array.isArray(ticket.observaciones) ? ticket.observaciones : [],
        imagenes
      };
    }));

    return res.json(tickets);
  } catch (error) {
    console.error('Error inesperado al obtener tickets de Ventas:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


 // Crear un IT de la ticketera
router.post('/crearIT', async (req, res) => {
  const it = req.body?.it;

  if (!it || typeof it !== 'object' || Array.isArray(it)) {
    return res.status(400).json({
      error: 'Los datos del IT son obligatorios.'
    });
  }

  try {
    const result = await createTicketeraCase(
      'IT',
      it,
      typeof req.user?.email === 'string' ? req.user.email.trim() : ''
    );
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error en el servidor al crear IT:', error);
    const statusCode = error.code === 'P0001' || error.code === '22007' ? 400 : 500;
    return res.status(statusCode).json({ error: 'No se pudo crear el IT.', ...(statusCode === 400 ? { detalle: error.message } : {}) });
  }
});

router.patch('/actualizarEstadoTicketera', requireTicketeraCase('ONBOARDING'), async (req, res) => {
  if (!hasBackOfficeAccess(req.user)) {
    return res.status(403).json({
      error: 'Solo los perfiles de Back Office o Desarrollo pueden actualizar casos.'
    });
  }

  const casoId = Number(req.body?.caso_id);
  const estado = typeof req.body?.estado === 'string' ? req.body.estado.trim() : '';
  const observacion = typeof req.body?.observacion === 'string' ? req.body.observacion.trim() : '';

  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    return res.status(400).json({ error: 'El caso_id debe ser un ID numérico válido.' });
  }
  if (!ESTADOS_TICKETERA.has(estado)) {
    return res.status(400).json({ error: 'Seleccioná un estado válido.' });
  }
  if (!observacion || observacion.length > 500) {
    return res.status(400).json({
      error: 'La observación es obligatoria y no puede superar los 500 caracteres.'
    });
  }

  try {
    const { data, error } = await supabase.rpc('actualizar_estado_ticketera', {
      p_caso_id: casoId,
      p_estado: estado,
      p_observacion: observacion,
      p_email: typeof req.user?.email === 'string' ? req.user.email.trim() : null,
      p_numero_it: null
    });

    if (error) {
      console.error('Error al actualizar el estado del caso de ticketera:', error);
      if (error.message?.includes('No existe un caso')) {
        return res.status(404).json({ error: 'No existe un caso con ese ID.' });
      }
      return res.status(500).json({ error: 'No se pudo actualizar el caso.' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error inesperado al actualizar el caso de ticketera:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.patch('/actualizarEstadoTicketeraVentas', requireTicketeraCase('VENTAS'), async (req, res) => {
  if (!hasBackOfficeAccess(req.user)) {
    return res.status(403).json({
      error: 'Solo los perfiles de Back Office o Desarrollo pueden actualizar tickets de Ventas.'
    });
  }

  const casoId = Number(req.body?.caso_id);
  if (req.body?.estado !== undefined && req.body.estado !== null && typeof req.body.estado !== 'string') {
    return res.status(400).json({ error: 'El estado debe ser texto.' });
  }
  if (req.body?.observacion !== undefined
    && req.body.observacion !== null
    && typeof req.body.observacion !== 'string') {
    return res.status(400).json({ error: 'La observación debe ser texto.' });
  }
  const estado = typeof req.body?.estado === 'string' ? req.body.estado.trim() : '';
  const observacion = typeof req.body?.observacion === 'string' ? req.body.observacion.trim() : '';
  const numeroIt = req.body?.numero_it === undefined || req.body?.numero_it === null
    ? ''
    : typeof req.body.numero_it === 'string'
      ? req.body.numero_it.trim()
      : null;
  const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';

  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    return res.status(400).json({ error: 'El caso_id debe ser un ID numérico válido.' });
  }
  if (numeroIt === null || (numeroIt && numeroIt.length > 100)) {
    return res.status(400).json({ error: 'El número de IT debe ser texto y no puede superar los 100 caracteres.' });
  }
  if (estado && !ESTADOS_TICKETERA_VENTAS.has(estado)) {
    return res.status(400).json({ error: 'Seleccioná un estado válido para Ventas.' });
  }
  if (!estado && !observacion) {
    return res.status(400).json({ error: 'Indicá un estado nuevo o una observación.' });
  }
  if (observacion.length > 500) {
    return res.status(400).json({ error: 'La observación no puede superar los 500 caracteres.' });
  }
  if (!email) {
    return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });
  }

  try {
    if (numeroIt) {
      if (!estado || !observacion) {
        return res.status(400).json({
          error: 'Para cargar el número de IT, indicá un estado y una observación.'
        });
      }
      const { data, error } = await supabase.rpc('actualizar_estado_ticketera', {
        p_caso_id: casoId,
        p_estado: estado,
        p_observacion: observacion,
        p_email: email,
        p_numero_it: numeroIt
      });
      if (error) {
        console.error('Error al actualizar ticket de Ventas con número de IT:', error);
        if (error.message?.includes('No existe un caso')) {
          return res.status(404).json({ error: 'El caso no existe o no pertenece a la ticketera de Ventas.' });
        }
        return res.status(500).json({ error: 'No se pudo actualizar el ticket de Ventas.' });
      }
      return res.json(data);
    }

    const { data, error } = await supabase.rpc('actualizar_ticket_ventas', {
      p_caso_id: casoId,
      p_email: email,
      p_observacion: observacion || null,
      p_estado_nuevo: estado || null
    });

    if (error) {
      console.error('Error al actualizar ticket de Ventas:', error);
      if (error.message?.includes('no existe') || error.message?.includes('no pertenece')) {
        return res.status(404).json({ error: 'El caso no existe o no pertenece a la ticketera de Ventas.' });
      }
      return res.status(500).json({ error: 'No se pudo actualizar el ticket de Ventas.' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error inesperado al actualizar ticket de Ventas:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});



router.get('/lideresTicketera', async (req, res) => {
  const ticketera = typeof req.query.p_ticketera === 'string'
    ? req.query.p_ticketera.trim().toUpperCase()
    : '';
  if (!LIDERES_TICKETERAS.has(ticketera)) {
    return res.status(400).json({
      error: 'Indicá una ticketera válida: VENTAS, ONBOARDING o ABONO/DEGRA.'
    });
  }
  if (!hasTicketeraAccess(req, ticketera)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a los lideres de esta ticketera.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_lideres_ticketera', {
      p_ticketera: ticketera
    });
    if (error) {
      console.error(`Error al obtener líderes de ${ticketera}:`, error);
      return res.status(500).json({ error: 'No se pudieron obtener los líderes de la ticketera.' });
    }
    if (!Array.isArray(data)) {
      console.error(`obtener_lideres_ticketera(${ticketera}) no devolvió una lista.`);
      return res.status(502).json({ error: 'La respuesta de líderes no tiene el formato esperado.' });
    }

    const leaders = data
      .filter((leader) => leader && typeof leader === 'object' && !Array.isArray(leader))
      .map((leader) => ({
        id: leader.id,
        usuario: leader.usuario,
        nombre: typeof leader.nombre === 'string' ? leader.nombre.trim() : '',
        mail: typeof leader.mail === 'string' ? leader.mail.trim() : ''
      }))
      .filter((leader) => leader.nombre);

    return res.json(leaders);
  } catch (error) {
    console.error(`Error inesperado al obtener líderes de ${ticketera}:`, error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.get('/lideresTck', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('obtener_lideres_tck');
    if (error) {
      console.error('Error al obtener líderes de la Ticketera:', error);
      return res.status(500).json({ error: 'No se pudieron obtener los líderes.' });
    }

    if (!Array.isArray(data)) {
      console.error('La función obtener_lideres_tck no devolvió una lista.');
      return res.status(502).json({ error: 'La respuesta de líderes no tiene el formato esperado.' });
    }

    const leaders = data
      .filter((leader) => leader && typeof leader === 'object' && !Array.isArray(leader))
      .map((leader) => ({ nombre: typeof leader.nombre === 'string' ? leader.nombre.trim() : '' }))
      .filter((leader) => leader.nombre);

    return res.json(leaders);
  } catch (error) {
    console.error('Error inesperado al obtener líderes de la Ticketera:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


router.post('/subirImagenesTicketera', (_req, res) => {
  return res.status(403).json({ error: 'Las imagenes solo se pueden adjuntar durante la creacion del ticket.' });
});

async function saveInitialImages(req, res) {
  const casoId = Number(req.body?.caso_id);
  const archivos = req.files || [];

  const bucket = 'ticketera-imagenes';
  const rutasSubidas = [];

  try {
    // 1. Verificar que el ticket exista y obtener su código.
    const { data: caso, error: errorCaso } = await supabase
      .schema('tickets_soporte')
      .from('ticketera_casos')
      .select('id, id_tck, tipo_reg, tipo_ticketera')
      .eq('id', casoId)
      .maybeSingle();

    if (errorCaso) throw errorCaso;

    if (!caso) throw new Error('No se pudo encontrar el caso recien creado para guardar sus imagenes.');

    if (normalizeTicketera(caso.tipo_ticketera) !== req.createdTicketera
      || !hasTicketeraAccess(req, caso.tipo_ticketera)) {
      throw new Error('El caso creado no pertenece a una ticketera autorizada.');
    }

    // 2. Consultar las posiciones que ya están ocupadas.
    const { data: existentes, error: errorExistentes } = await supabase
      .schema('tickets_soporte')
      .from('ticketera_imagenes')
      .select('orden')
      .eq('caso_id', casoId);

    if (errorExistentes) throw errorExistentes;
    if (!Array.isArray(existentes) || existentes.length) {
      throw new Error('El caso ya tiene imagenes o no se pudo comprobar su carga inicial.');
    }

    const imagenesRegistradas = [];
    const imagenesOptimizadas = req.initialImages;

    // 3. Subir cada imagen y registrar sus metadatos.
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i];
      const imagen = imagenesOptimizadas[i];
      const orden = i + 1;

      const nombreArchivo = `${caso.id_tck}-${orden}${imagen.extension}`;
      const ruta = `tickets/${caso.id_tck}/${nombreArchivo}`;

      const { error: errorSubida } = await supabase
        .storage
        .from(bucket)
        .upload(ruta, imagen.buffer, {
          contentType: imagen.contentType,
          upsert: false
        });

      if (errorSubida) throw errorSubida;

      rutasSubidas.push(ruta);

      const { data: registro, error: errorRegistro } = await supabase
        .schema('tickets_soporte')
        .from('ticketera_imagenes')
        .insert({
          caso_id: caso.id,
          ruta_archivo: ruta,
          nombre_original: path.basename(archivo.originalname),
          orden,
          tipo_mime: imagen.contentType,
          tamano_bytes: imagen.size
        })
        .select('id, caso_id, ruta_archivo, orden')
        .single();

      if (errorRegistro) throw errorRegistro;

      imagenesRegistradas.push(registro);
    }

    return res.status(201).json({
      ...req.createdTicket,
      ok: true,
      caso_id: caso.id,
      id_tck: caso.id_tck,
      imagenes: imagenesRegistradas
    });

  } catch (error) {
    console.error('Error al subir imágenes:', error);

    // Si falla una parte, intentar limpiar los archivos y registros
    // creados por esta solicitud.
    if (rutasSubidas.length > 0) {
      try {
        const { error: errorBorradoRegistros } = await supabase
          .schema('tickets_soporte')
          .from('ticketera_imagenes')
          .delete()
          .in('ruta_archivo', rutasSubidas);
        if (errorBorradoRegistros) throw errorBorradoRegistros;
      } catch (cleanupError) {
        console.error('Error al limpiar metadatos de imagenes:', cleanupError);
      }

      try {
        const { error: errorBorradoArchivos } = await supabase
          .storage
          .from(bucket)
          .remove(rutasSubidas);
        if (errorBorradoArchivos) throw errorBorradoArchivos;
      } catch (cleanupError) {
        console.error('Error al limpiar archivos de Storage:', cleanupError);
      }
    }

    return res.status(500).json({
      error: 'El ticket se creo, pero no se pudieron guardar las imagenes. No vuelvas a enviarlo para evitar duplicados.',
      ticketCreado: true,
      caso_id: req.createdTicket.caso_id,
      id_tck: req.createdTicket.id_tck
    });
  }
}


module.exports = router;
