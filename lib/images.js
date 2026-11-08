'use strict';
/**
 * Validación de imágenes recibidas del navegador (base64).
 * No se confía en el tipo declarado: se comprueban los primeros bytes del archivo.
 */
const ALLOWED = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * @returns {{ images: {mime:string, data:string, buffer:Buffer}[] } | { error:string }}
 */
function validateImages(list, { maxImages, maxImageBytes, maxTotalBytes }) {
  if (list == null) return { images: [] };
  if (!Array.isArray(list)) return { error: 'Formato de imágenes inválido.' };
  if (list.length > maxImages) return { error: `Demasiadas imágenes (máximo ${maxImages}).` };
  const out = []; let total = 0;
  for (const img of list) {
    if (!img || typeof img.mime !== 'string' || typeof img.data !== 'string') return { error: 'Formato de imagen inválido.' };
    if (!ALLOWED[img.mime]) return { error: 'Solo se aceptan imágenes JPG, PNG o WEBP.' };
    if (!B64.test(img.data)) return { error: 'La imagen no está codificada correctamente.' };
    const buffer = Buffer.from(img.data, 'base64');
    if (buffer.length > maxImageBytes) return { error: `Una imagen supera el tamaño máximo de ${Math.round(maxImageBytes / 1048576)} MB.` };
    if (!ALLOWED[img.mime](buffer)) return { error: 'El contenido del archivo no coincide con una imagen válida.' };
    total += buffer.length;
    if (total > maxTotalBytes) return { error: 'Las imágenes adjuntas pesan demasiado en total.' };
    out.push({ mime: img.mime, data: img.data, buffer });
  }
  return { images: out };
}

module.exports = { validateImages, EXT };
