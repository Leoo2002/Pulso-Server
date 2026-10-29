const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { optimizeImage, ImageValidationError } = require('./optimize-image');

function file(buffer, mimetype = 'image/png', originalname = 'captura.png') {
  return { buffer, mimetype, originalname, size: buffer.length };
}

test('reduces a large image to WebP, within 1920px, with measurable storage savings', async (t) => {
  const width = 2400;
  const height = 1600;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      data[offset] = x % 256;
      data[offset + 1] = y % 256;
      data[offset + 2] = (x + y) % 256;
    }
  }
  const input = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const result = await optimizeImage(file(input));
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.extension, '.webp');
  assert.equal(result.name, 'captura.webp');
  assert.equal(result.size, result.buffer.length);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1280);
  assert.ok(result.size < input.length * .5);
  t.diagnostic(`${input.length} -> ${result.size} bytes (${(100 * (1 - result.size / input.length)).toFixed(1)}% saved)`);
});

test('orients JPEG pixels correctly and removes EXIF, XMP and ICC metadata', async () => {
  const input = await sharp({
    create: { width: 40, height: 60, channels: 3, background: '#326699' }
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const result = await optimizeImage(file(input, 'image/jpeg', 'foto.jpg'));
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 60);
  assert.equal(metadata.height, 40);
  for (const field of ['orientation', 'exif', 'icc', 'iptc', 'xmp']) {
    assert.equal(metadata[field], undefined);
  }
});

test('does not enlarge small images and preserves transparency', async () => {
  const input = await sharp({
    create: { width: 64, height: 32, channels: 4, background: { r: 80, g: 90, b: 200, alpha: .5 } }
  }).png().toBuffer();
  const result = await optimizeImage(file(input));
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.hasAlpha, true);
  const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(data[3] - 128) <= 1);
});

test('keeps an already smaller clean original rather than storing a larger conversion', async () => {
  const input = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#000000' }
  }).webp({ lossless: true }).toBuffer();
  const result = await optimizeImage(file(input, 'image/webp', 'mini.webp'));
  assert.ok(result.size <= input.length);
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.extension, '.webp');
});

test('rejects invalid bytes, truncated images and disguised formats with explicit validation errors', async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer();
  for (const input of [
    file(Buffer.from('not an image')),
    file(png.subarray(0, png.length - 30)),
    file(png, 'image/jpeg', 'disguised.jpg'),
    file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'))
  ]) {
    await assert.rejects(() => optimizeImage(input), ImageValidationError);
  }
});

test('rejects excessive decoded dimensions before processing the pixels', async () => {
  const input = await sharp({
    create: { width: 8000, height: 5001, channels: 3, background: 'white' }
  }).png().toBuffer();
  await assert.rejects(() => optimizeImage(file(input)), ImageValidationError);
});

test('rejects animated WebP explicitly instead of silently discarding its later frames', async () => {
  const header = '47494638396101000100800000000000ffffff';
  const frame = '21f90400010000002c0000000001000100000202440100';
  const secondFrame = frame.replace('02440100', '024c0100');
  const gif = Buffer.from(header + frame + secondFrame + '3b', 'hex');
  const input = await sharp(gif, { animated: true }).webp().toBuffer();
  assert.equal((await sharp(input).metadata()).pages, 2);
  await assert.rejects(() => optimizeImage(file(input, 'image/webp', 'animated.webp')), {
    name: 'ImageValidationError',
    message: 'Solo se permiten imágenes estáticas, sin animación.'
  });
});

test('uses a matching safe filename for the stored format', async () => {
  const input = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'white' }
  }).png().toBuffer();
  const result = await optimizeImage(file(input, 'image/png', '..\\carpeta/captura.png'));
  assert.ok(!/[\\/]/.test(result.name));
  assert.ok(result.name.endsWith(result.extension));
  assert.ok(result.name.length <= 150);
});
