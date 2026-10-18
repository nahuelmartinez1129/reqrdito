const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const LADO_MAXIMO = 1600;

class ImagenInvalidaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImagenInvalidaError';
  }
}

// Firma de los formatos aceptados: JPEG, PNG y WebP
function esImagenAceptada(inputPath) {
  const fd = fs.openSync(inputPath, 'r');
  const cabecera = Buffer.alloc(12);
  try {
    fs.readSync(fd, cabecera, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  const jpeg = cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff;
  const png = cabecera.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = cabecera.toString('latin1', 0, 4) === 'RIFF' && cabecera.toString('latin1', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

// Reescribe la foto como JPEG de hasta 1600 px por lado y sin metadatos (EXIF, GPS).
// Si no es una imagen que ffmpeg pueda decodificar, rechaza con ImagenInvalidaError.
// El archivo de salida parcial se borra ante cualquier error.
const convertirImagen = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const fallar = (err) => {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignorar */ }
      reject(err);
    };

    try {
      if (!esImagenAceptada(inputPath)) return fallar(new ImagenInvalidaError('Formato de imagen no aceptado'));
    } catch (err) {
      return fallar(err);
    }

    ffmpeg(inputPath)
      .outputOptions([
        '-frames:v', '1',
        '-vf', `scale='min(${LADO_MAXIMO},iw)':'min(${LADO_MAXIMO},ih)':force_original_aspect_ratio=decrease`,
        '-map_metadata', '-1',
        '-q:v', '3'
      ])
      .toFormat('mjpeg')
      .on('end', () => {
        try {
          if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            return fallar(new ImagenInvalidaError('El archivo no contiene una imagen'));
          }
        } catch (err) {
          return fallar(err);
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        // ENOENT = ffmpeg no instalado: es un error del servidor, no del archivo
        if (/ENOENT|Cannot find ffmpeg/i.test(err.message)) return fallar(err);
        fallar(new ImagenInvalidaError('Imagen inválida'));
      })
      .save(outputPath);
  });
};

module.exports = convertirImagen;
module.exports.ImagenInvalidaError = ImagenInvalidaError;
module.exports.esImagenAceptada = esImagenAceptada;
