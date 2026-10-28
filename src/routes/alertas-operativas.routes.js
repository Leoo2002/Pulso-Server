const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { supabase } = require('../config/database');
const { hasBackOfficeAccess } = require('../utils/ticket-access');
const { loadTicketeraAccess } = require('../middlewares/ticketera-access');

const router = express.Router();
const IMAGE_BUCKET = 'ticketera-imagenes';
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const SERVICES = {
  VENTAS: 'TICKETERA_VENTAS',
  ONBOARDING: 'TICKETERA_ONBOARDING',
  DEGRA: 'TICKETERA_ABONO_DEGRA',
  'ABONO/DEGRA': 'TICKETERA_ABONO_DEGRA'
};
const SERVICE_ALIASES = { 'ABONO/DEGRA': 'DEGRA' };
const MAX_LENGTHS = {
  titulo_aviso: 200,
  tipo_severidad: 40,
  comentario: 5000
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      return callback(new Error('Solo se permiten imágenes JPEG, PNG o WebP.'));
    }
    return callback(null, true);
  }
});

function receiveAlertImage(req, res, next) {
  upload.single('imagen')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || 'No se pudo recibir la imagen.' });
    }
    return next();
  });
}

function requireServiceAccess(req, res, next) {
  return loadTicketeraAccess(req, res, () => authorizeService(req, res, next));
}

async function authorizeService(req, res, next) {
  const requestedService = typeof req.query.servicio === 'string'
    ? req.query.servicio.trim().toLocaleUpperCase('es')
    : typeof req.body?.servicio === 'string'
      ? req.body.servicio.trim().toLocaleUpperCase('es')
      : '';
  const service = SERVICE_ALIASES[requestedService] || requestedService;
  const requiredTool = SERVICES[service];
  if (!requiredTool) {
    return res.status(400).json({ error: 'El servicio debe ser VENTAS, ONBOARDING o DEGRA.' });
  }

  const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (!email) return res.status(401).json({ error: 'No se pudo identificar al usuario autenticado.' });

  try {
    const grantedTools = new Set(req.ticketeraAccess.map((tool) => tool.nombre));
    if (!grantedTools.has(requiredTool)) {
      return res.status(403).json({ error: 'No tienes permisos para acceder a las alertas de este servicio.' });
    }

    req.operationalAlertService = service;
    if (req.method === 'POST') {
      const requestedServices = req.body?.servicios;
      let services;
      try {
        services = typeof requestedServices === 'string'
          ? JSON.parse(requestedServices)
          : requestedServices;
      } catch {
        return res.status(400).json({ error: 'La selección de ticketeras no tiene un formato válido.' });
      }
      if (!Array.isArray(services) || !services.length
        || services.some((item) => typeof item !== 'string')) {
        return res.status(400).json({ error: 'Seleccioná al menos una ticketera para mostrar la alerta.' });
      }
      const normalizedServices = services.map((item) => {
        const key = item.trim().toLocaleUpperCase('es');
        return SERVICE_ALIASES[key] || key;
      });
      if (normalizedServices.some((item) => !['VENTAS', 'ONBOARDING', 'DEGRA'].includes(item))) {
        return res.status(400).json({ error: 'Seleccioná únicamente Ventas, Onboarding o Abono/Degra.' });
      }
      const uniqueServices = [...new Set(normalizedServices)];
      const missingAccess = uniqueServices.find((item) => !grantedTools.has(SERVICES[item]));
      if (missingAccess) {
        return res.status(403).json({
          error: `No tienes permisos para publicar alertas en ${missingAccess}.`
        });
      }
      req.operationalAlertServices = uniqueServices;
    }
    return next();
  } catch (error) {
    console.error('Error al verificar el acceso a alertas operativas:', error);
    return res.status(500).json({ error: 'No se pudieron verificar los permisos de alertas operativas.' });
  }
}

function normalizeAlert(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { error: 'Los datos de la alerta son obligatorios.' };
  }

  const normalized = {};
  for (const [field, maxLength] of Object.entries(MAX_LENGTHS)) {
    const value = alert[field] ?? '';
    if (typeof value !== 'string') return { error: 'Los campos de la alerta deben ser texto.' };
    normalized[field] = value.trim();
    if (normalized[field].length > maxLength) {
      return { error: `El campo ${field} supera el máximo de ${maxLength} caracteres.` };
    }
  }

  if (!normalized.titulo_aviso || !normalized.tipo_severidad || !normalized.comentario) {
    return { error: 'Título, severidad y comentario son obligatorios.' };
  }
  return { alert: normalized };
}

function isAlertRecord(alert) {
  return alert
    && typeof alert === 'object'
    && !Array.isArray(alert)
    && typeof alert.titulo_aviso === 'string'
    && typeof alert.tipo_severidad === 'string'
    && typeof alert.comentario === 'string'
    && typeof alert.servicio === 'string'
    && (alert.imagen_url === null || typeof alert.imagen_url === 'string')
    && typeof alert.fecha_creacion === 'string';
}

async function getDisplayImageUrl(imagePath) {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(imagePath, 3600);
  if (error) throw error;
  if (typeof data?.signedUrl !== 'string' || !data.signedUrl) {
    throw new Error('No se pudo generar el enlace temporal de la imagen.');
  }
  return data.signedUrl;
}

async function withDisplayImageUrl(alert) {
  return {
    ...alert,
    imagen_url: await getDisplayImageUrl(alert.imagen_url)
  };
}

router.get('/alertas-operativas', requireServiceAccess, async (req, res) => {
  const severity = typeof req.query.tipo_severidad === 'string'
    ? req.query.tipo_severidad.trim()
    : null;
  if (severity && severity.length > MAX_LENGTHS.tipo_severidad) {
    return res.status(400).json({ error: 'La severidad no puede superar los 40 caracteres.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_alertas_operativas', {
      p_servicio: req.operationalAlertService,
      p_tipo_severidad: severity
    });
    if (error) {
      console.error('Error al obtener alertas operativas:', error);
      return res.status(500).json({ error: 'No se pudieron obtener las alertas operativas.' });
    }
    if (!Array.isArray(data) || data.some((alert) => !isAlertRecord(alert))) {
      console.error('obtener_alertas_operativas devolvió una respuesta inválida.');
      return res.status(502).json({ error: 'La respuesta de alertas operativas tiene un formato inválido.' });
    }
    const alerts = await Promise.all(data.map(withDisplayImageUrl));
    return res.json(alerts);
  } catch (error) {
    console.error('Error inesperado al obtener alertas operativas:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/alertas-operativas', receiveAlertImage, requireServiceAccess, async (req, res) => {
  if (!hasBackOfficeAccess(req.user)) {
    return res.status(403).json({ error: 'Solo los perfiles de gestión pueden cargar alertas operativas.' });
  }
  const normalized = normalizeAlert(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const image = req.file;
  const imageExtension = image ? IMAGE_EXTENSIONS[image.mimetype] : null;
  const imagePath = image
    ? `alertas-operativas/${req.operationalAlertServices[0].toLocaleLowerCase('es')}/${randomUUID()}${imageExtension}`
    : null;
  let uploadedImagePath = null;
  try {
    let displayImageUrl = null;
    if (image && imagePath) {
      const { error: uploadError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(imagePath, image.buffer, {
          contentType: image.mimetype,
          upsert: false
        });
      if (uploadError) throw uploadError;
      uploadedImagePath = imagePath;
      displayImageUrl = await getDisplayImageUrl(imagePath);
    }

    const { data, error } = await supabase.rpc('crear_alerta_operativa_multi', {
      p_titulo_aviso: normalized.alert.titulo_aviso,
      p_tipo_severidad: normalized.alert.tipo_severidad,
      p_comentario: normalized.alert.comentario,
      p_servicios: req.operationalAlertServices,
      p_imagen_url: imagePath
    });
    if (error) {
      console.error('Error al crear alerta operativa:', error);
      if (uploadedImagePath) {
        const { error: cleanupError } = await supabase.storage.from(IMAGE_BUCKET).remove([uploadedImagePath]);
        if (cleanupError) console.error('No se pudo limpiar la imagen de una alerta fallida:', cleanupError);
        uploadedImagePath = null;
      }
      return res.status(500).json({ error: 'No se pudo crear la alerta operativa.' });
    }
    const alert = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!isAlertRecord(alert)) {
      console.error('crear_alerta_operativa devolvió una respuesta inválida:', data);
      return res.status(502).json({ error: 'La alerta se creó, pero la respuesta no tiene el formato esperado.' });
    }
    uploadedImagePath = null;
    return res.status(201).json({ ...alert, imagen_url: displayImageUrl });
  } catch (error) {
    console.error('Error inesperado al crear alerta operativa:', error);
    if (uploadedImagePath) {
      const { error: cleanupError } = await supabase.storage.from(IMAGE_BUCKET).remove([uploadedImagePath]);
      if (cleanupError) console.error('No se pudo limpiar la imagen de una alerta fallida:', cleanupError);
    }
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.delete('/alertas-operativas/:id', requireServiceAccess, async (req, res) => {
  if (!hasBackOfficeAccess(req.user)) {
    return res.status(403).json({ error: 'Solo los perfiles de gestión pueden eliminar alertas operativas.' });
  }

  const alertId = Number(req.params.id);
  if (!Number.isSafeInteger(alertId) || alertId <= 0) {
    return res.status(400).json({ error: 'El ID de la alerta debe ser un número válido.' });
  }

  try {
    const { data, error } = await supabase.rpc('eliminar_alerta_operativa', { p_id: alertId });
    if (error) {
      console.error('Error al eliminar alerta operativa:', error);
      if (typeof error.message === 'string' && error.message.includes('No existe una alerta')) {
        return res.status(404).json({ error: 'No existe una alerta con ese ID.' });
      }
      return res.status(500).json({ error: 'No se pudo eliminar la alerta operativa.' });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.estado !== 'ok'
      || !data.alerta || typeof data.alerta !== 'object' || Array.isArray(data.alerta)) {
      console.error('eliminar_alerta_operativa devolvió una respuesta inválida:', data);
      return res.status(502).json({ error: 'La alerta se eliminó, pero la respuesta no tiene el formato esperado.' });
    }

    const imagePath = typeof data.alerta.imagen_url === 'string'
      && !/^https?:\/\//i.test(data.alerta.imagen_url)
      ? data.alerta.imagen_url
      : null;
    if (imagePath) {
      const { error: imageError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .remove([imagePath]);
      if (imageError) {
        console.error(`La alerta ${alertId} se eliminó, pero no se pudo eliminar su imagen:`, imageError);
        return res.status(500).json({
          error: 'La alerta se eliminó, pero no se pudo borrar su imagen del almacenamiento.'
        });
      }
    }

    return res.json({
      estado: data.estado,
      mensaje: data.mensaje || 'Alerta eliminada correctamente.',
      alerta: data.alerta
    });
  } catch (error) {
    console.error('Error inesperado al eliminar alerta operativa:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
