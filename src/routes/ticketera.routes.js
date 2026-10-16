
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { isBackOffice } = require('../utils/ticket-access');

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
const ESTADOS_TICKETERA = new Set(['pendiente', 'en_curso', 'resuelto', 'cancelado', 'mal_cargado']);

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

    return res.status(201).json(data);

  } catch (error) {
    console.error('Error en el servidor al crear ticket:', error);

    return res.status(500).json({
      error: 'Error interno del servidor.'
    });
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
  if (!allowAnyProfileForTesting && !isBackOffice(req.user)) {
    return res.status(403).json({
      error: 'Solo el perfil Back Office puede actualizar casos. Para pruebas locales se puede habilitar TICKETERA_ALLOW_ANY_PROFILE=true.'
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



router.get('/lideresTck', async (req, res) => {
    try {
        const { data, error } = await supabase.rpc(
            'obtener_lideres_tck'
        );

        if (error) {
            console.error('Error al obtener líderes:', error);
            return res.status(500).json({
                error: 'No se pudieron obtener los líderes'
            });
        }

        return res.json(data ?? []);
    } catch (error) {
        console.error('Error inesperado:', error);

        return res.status(500).json({
            error: 'Error interno del servidor'
        });
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
      .select('id, id_tck, tipo_reg')
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
