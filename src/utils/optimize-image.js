const sharp = require('sharp');

const MAX_DIMENSION = 1920;
const INPUT_OPTIONS = { limitInputPixels: 40_000_000, failOn: 'warning' };
const FORMATS = {
  jpeg: { contentType: 'image/jpeg', extension: '.jpg' },
  png: { contentType: 'image/png', extension: '.png' },
  webp: { contentType: 'image/webp', extension: '.webp' }
};

class ImageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

async function optimizeImage(file) {
  let metadata;
  let pixels;
  try {
    const image = sharp(file.buffer, INPUT_OPTIONS);
    metadata = await image.metadata();
    const format = FORMATS[metadata.format];
    if (!format || format.contentType !== file.mimetype) {
      throw new ImageValidationError('El contenido de la imagen no coincide con su formato declarado.');
    }
    if ((metadata.pages || 1) !== 1) {
      throw new ImageValidationError('Solo se permiten imágenes estáticas, sin animación.');
    }
    pixels = await image.rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError(
      'No se pudo leer la imagen. Usá un JPG, PNG o WebP válido de hasta 40 megapíxeles.'
    );
  }

  const raw = {
    width: pixels.info.width,
    height: pixels.info.height,
    channels: pixels.info.channels
  };
  const encoder = () => sharp(pixels.data, { raw });
  let buffer = await encoder().webp({ quality: 82, effort: 4, smartSubsample: true }).toBuffer();
  let format = FORMATS.webp;

  if (buffer.length >= file.buffer.length) {
    const originalFormat = metadata.format === 'jpeg'
      ? encoder().jpeg({ quality: 85, mozjpeg: true })
      : metadata.format === 'png'
        ? encoder().png({ compressionLevel: 9 })
        : null;
    if (originalFormat) {
      const alternative = await originalFormat.toBuffer();
      if (alternative.length < buffer.length) {
        buffer = alternative;
        format = FORMATS[metadata.format];
      }
    }

    // Only reuse an original that already meets the size, orientation and metadata policy.
    const canKeepOriginal = metadata.width <= MAX_DIMENSION && metadata.height <= MAX_DIMENSION
      && !metadata.orientation && !metadata.exif && !metadata.icc
      && !metadata.iptc && !metadata.xmp && !metadata.hasProfile && !metadata.comments?.length;
    if (canKeepOriginal && file.buffer.length <= buffer.length) {
      buffer = file.buffer;
      format = FORMATS[metadata.format];
    }
  }

  const originalName = file.originalname.replace(/[\\/]/g, '_');
  const stem = originalName.replace(/\.[^.]*$/, '').slice(0, 140) || 'imagen';
  return {
    buffer,
    contentType: format.contentType,
    extension: format.extension,
    size: buffer.length,
    name: `${stem}${format.extension}`
  };
}

module.exports = { optimizeImage, ImageValidationError };
