const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function streamStorageObject({ supabase, bucket, path, res, contentType, disposition = 'inline', filename }) {
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    const error = new Error('El tipo de imagen almacenada no está permitido.');
    error.status = 415;
    throw error;
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60);
  if (signedUrlError) throw signedUrlError;
  if (typeof data?.signedUrl !== 'string' || !data.signedUrl) {
    throw new Error('No se pudo generar el acceso temporal a la imagen.');
  }

  let upstream;
  try {
    upstream = await fetch(data.signedUrl);
  } catch (error) {
    const proxyError = new Error('No se pudo conectar con el almacenamiento de imágenes.');
    proxyError.status = 502;
    proxyError.cause = error;
    throw proxyError;
  }

  if (upstream.status === 404) {
    const error = new Error('No se encontró la imagen almacenada.');
    error.status = 404;
    throw error;
  }
  if (!upstream.ok || !upstream.body) {
    const error = new Error('No se pudo obtener la imagen almacenada.');
    error.status = 502;
    throw error;
  }

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (filename) {
    headers['Content-Disposition'] = `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  res.status(200).set(headers);
  await pipeline(Readable.fromWeb(upstream.body), res);
}

module.exports = { streamStorageObject };
