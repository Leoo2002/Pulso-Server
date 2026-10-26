
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { hasBackOfficeAccess } = require('../utils/ticket-access');

const multer = require('multer');
const path = require('path');


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB por imagen
    files: 3
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
  'pendiente',
  'en_curso',
  'resuelto',
  'cancelado',
  'mal_cargado',
  'cancelado_duplicado',
  'cancelado_no_corresponde'
]);
const ESTADOS_TICKETERA_VENTAS = new Set([
  'reportado',
  'cerrado ok',
  'no corresponde',
  'no corresponde duplicado',
  'derivacion incorrecta'
]);

const recibirImagenes = (req, res, next) => {
  upload.array('imagenes', 3)(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: error.message || 'No se pudieron recibir las imágenes.'
      });
    }

    next();
  });
};


// Crear un ticket de la ticketera
router.post('/crearTicketeraTicket', async (req, res) => {
  const ticket = req.body?.ticket;

  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({
      error: 'Los datos del ticket son obligatorios.'
    });
  }

  try {
    const { data, error } = await supabase.rpc(
      'crear_ticket',
      {
        p_ticket: ticket
      }
    );

    if (error) {
      console.error('Error al crear ticket:', error);

      return res.status(500).json({
        error: 'No se pudo crear el ticket.',
        detalle: error.message
      });
    }

    const result = data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : { caso_id: data };
    const casoId = Number(result.caso_id);
    let idTck = typeof result.id_tck === 'string' && result.id_tck.trim()
      ? result.id_tck.trim()
      : null;

    if (!idTck && Number.isSafeInteger(casoId) && casoId > 0) {
      try {
        const { data: caso, error: errorIdTck } = await supabase
          .schema('tickets_soporte')
          .from('ticketera_casos')
          .select('id_tck')
          .eq('id', casoId)
          .maybeSingle();

        if (errorIdTck) {
          console.error('El ticket se creó, pero no se pudo consultar su id_tck:', errorIdTck);
        } else if (typeof caso?.id_tck === 'string' && caso.id_tck.trim()) {
          idTck = caso.id_tck.trim();
        }
      } catch (errorIdTck) {
        console.error('El ticket se creó, pero no se pudo consultar su id_tck:', errorIdTck);
      }
    }

    return res.status(201).json({ ...result, id_tck: idTck });

  } catch (error) {
    console.error('Error en el servidor al crear ticket:', error);

    return res.status(500).json({
      error: 'Error interno del servidor.'
    });
  }
});

router.post('/crearTicketeraTicketVentas', async (req, res) => {
  const ticket = req.body?.ticket;

  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return res.status(400).json({
      error: 'Los datos del ticket de Ventas son obligatorios.'
    });
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
    const { data, error } = await supabase.rpc('crear_ticket_ventas', {
      p_ticket: ticket
    });

    if (error) {
      console.error('Error al crear ticket de Ventas:', error);
      return res.status(500).json({
        error: 'No se pudo crear el ticket de Ventas.',
        detalle: error.message
      });
    }

    const casoId = Number(data);
    let idTck = null;
    if (Number.isSafeInteger(casoId) && casoId > 0) {
      try {
        const { data: caso, error: errorIdTck } = await supabase
          .schema('tickets_soporte')
          .from('ticketera_casos')
          .select('id_tck')
          .eq('id', casoId)
          .maybeSingle();

        if (errorIdTck) {
          console.error('El ticket de Ventas se creó, pero no se pudo consultar su id_tck:', errorIdTck);
        } else if (typeof caso?.id_tck === 'string' && caso.id_tck.trim()) {
          idTck = caso.id_tck.trim();
        }
      } catch (errorIdTck) {
        console.error('El ticket de Ventas se creó, pero no se pudo consultar su id_tck:', errorIdTck);
      }
    } else {
      console.error('crear_ticket_ventas devolvió un caso_id no representable para adjuntos:', data);
    }

    return res.status(201).json({ caso_id: data, id_tck: idTck });
  } catch (error) {
    console.error('Error en el servidor al crear ticket de Ventas:', error);
    return res.status(500).json({
      error: 'Error interno del servidor.'
    });
  }
});

router.get('/obtenerTicketsVentas', async (req, res) => {
  const search = typeof req.query.p_busqueda === 'string' ? req.query.p_busqueda.trim() : 'All';
  if (search.length > 100) {
    return res.status(400).json({ error: 'La búsqueda no puede superar los 100 caracteres.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_tickets_ventas', {
      p_busqueda: search || 'All'
    });
    if (error) {
      console.error('Error al obtener tickets de Ventas:', error);
      return res.status(500).json({ error: 'No se pudieron obtener los tickets de Ventas.' });
    }
    if (!Array.isArray(data)) {
      console.error('La función obtener_tickets_ventas no devolvió una lista.');
      return res.status(502).json({ error: 'La respuesta de tickets de Ventas no tiene el formato esperado.' });
    }

    const tickets = await Promise.all(data.map(async (ticket, index) => {
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
        tipo_ticketera: ticket.tipo_ticketera || 'VENTAS',
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
    const { data, error } = await supabase.rpc(
      'crear_it',
      {
        p_it: it
      }
    );

    if (error) {
      console.error('Error al crear IT:', error);

      return res.status(500).json({
        error: 'No se pudo crear el IT.',
        detalle: error.message
      });
    }

    return res.status(201).json(data);

  } catch (error) {
    console.error('Error en el servidor al crear IT:', error);

    return res.status(500).json({
      error: 'Error interno del servidor.'
    });
  }
});

router.patch('/actualizarEstadoTicketera', async (req, res) => {
  const allowAnyProfileForTesting = process.env.TICKETERA_ALLOW_ANY_PROFILE === 'true';
  if (!allowAnyProfileForTesting && !hasBackOfficeAccess(req.user)) {
    return res.status(403).json({
      error: 'Solo los perfiles de Back Office o Desarrollo pueden actualizar casos. Para pruebas locales se puede habilitar TICKETERA_ALLOW_ANY_PROFILE=true.'
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
      p_email: typeof req.user?.email === 'string' ? req.user.email.trim() : null
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

router.patch('/actualizarEstadoTicketeraVentas', async (req, res) => {
  const allowAnyProfileForTesting = process.env.TICKETERA_ALLOW_ANY_PROFILE === 'true';
  if (!allowAnyProfileForTesting && !hasBackOfficeAccess(req.user)) {
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
  const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';

  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    return res.status(400).json({ error: 'El caso_id debe ser un ID numérico válido.' });
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


router.post('/subirImagenesTicketera', recibirImagenes, async (req, res) => {
  const casoId = Number(req.body?.caso_id);
  const archivos = req.files || [];

  if (!Number.isSafeInteger(casoId) || casoId <= 0) {
    return res.status(400).json({
      error: 'El caso_id debe ser un ID numérico válido.'
    });
  }

  if (archivos.length === 0) {
    return res.status(400).json({
      error: 'Tenés que adjuntar al menos una imagen.'
    });
  }

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

    if (!caso) {
      return res.status(404).json({
        error: 'No existe un ticket con ese caso_id.'
      });
    }

    if (String(caso.tipo_reg).toUpperCase() === 'ITRACKER') {
      if (archivos.some((archivo) => !['image/jpeg', 'image/png'].includes(archivo.mimetype))) {
        return res.status(400).json({
          error: 'ITracker solo admite imágenes JPG o PNG.'
        });
      }
      if (archivos.reduce((total, archivo) => total + archivo.size, 0) > MAX_IT_IMAGES_SIZE) {
        return res.status(400).json({
          error: 'El tamaño total de las imágenes de ITracker no puede superar 5 MB.'
        });
      }
    }

    if (String(caso.tipo_ticketera).toUpperCase() === 'VENTAS'
      && archivos.some((archivo) => !['image/jpeg', 'image/png'].includes(archivo.mimetype))) {
      return res.status(400).json({
        error: 'La ticketera Ventas solo admite imágenes JPG o PNG.'
      });
    }

    // 2. Consultar las posiciones que ya están ocupadas.
    const { data: existentes, error: errorExistentes } = await supabase
      .schema('tickets_soporte')
      .from('ticketera_imagenes')
      .select('orden')
      .eq('caso_id', casoId);

    if (errorExistentes) throw errorExistentes;

    const ocupados = new Set(
      (existentes || []).map((imagen) => Number(imagen.orden))
    );

    const posicionesLibres = [1, 2, 3].filter(
      (orden) => !ocupados.has(orden)
    );

    if (archivos.length > posicionesLibres.length) {
      return res.status(400).json({
        error: `Este ticket admite 3 imágenes como máximo. Ya tiene ${ocupados.size}.`
      });
    }

    const imagenesRegistradas = [];

    // 3. Subir cada imagen y registrar sus metadatos.
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i];
      const orden = posicionesLibres[i];

      const extensiones = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp'
      };

      const extension = extensiones[archivo.mimetype];

      const nombreArchivo = `${caso.id_tck}-${orden}${extension}`;
      const ruta = `tickets/${caso.id_tck}/${nombreArchivo}`;

      const { error: errorSubida } = await supabase
        .storage
        .from(bucket)
        .upload(ruta, archivo.buffer, {
          contentType: archivo.mimetype,
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
          tipo_mime: archivo.mimetype,
          tamano_bytes: archivo.size
        })
        .select('id, caso_id, ruta_archivo, orden')
        .single();

      if (errorRegistro) throw errorRegistro;

      imagenesRegistradas.push(registro);
    }

    return res.status(201).json({
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
      const { error: errorBorradoRegistros } = await supabase
        .schema('tickets_soporte')
        .from('ticketera_imagenes')
        .delete()
        .in('ruta_archivo', rutasSubidas);

      if (errorBorradoRegistros) {
        console.error(
          'Error al limpiar metadatos de imágenes:',
          errorBorradoRegistros
        );
      }

      const { error: errorBorradoArchivos } = await supabase
        .storage
        .from(bucket)
        .remove(rutasSubidas);

      if (errorBorradoArchivos) {
        console.error(
          'Error al limpiar archivos de Storage:',
          errorBorradoArchivos
        );
      }
    }

    return res.status(500).json({
      error: 'No se pudieron guardar las imágenes.'
    });
  }
});


module.exports = router;
