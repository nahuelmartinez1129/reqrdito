const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const DURACION_MAXIMA_SEG = 15 * 60;

class AudioInvalidoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudioInvalidoError';
  }
}

// Convierte cualquier audio decodificable a MP3. Si ffmpeg no puede leerlo
// (no es audio real, aunque tenga extensión o MIME de audio) rechaza con
// AudioInvalidoError. El archivo de salida parcial se borra ante cualquier error.
const convertirAudio = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const fallar = (err) => {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignorar */ }
      reject(err);
    };

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .duration(DURACION_MAXIMA_SEG)
      .toFormat('mp3')
      .on('end', () => {
        try {
          if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            return fallar(new AudioInvalidoError('El archivo no contiene audio'));
          }
        } catch (err) {
          return fallar(err);
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        // ENOENT = ffmpeg no instalado: es un error del servidor, no del archivo
        if (/ENOENT|Cannot find ffmpeg/i.test(err.message)) return fallar(err);
        fallar(new AudioInvalidoError('Archivo de audio inválido'));
      })
      .save(outputPath);
  });
};

module.exports = convertirAudio;
module.exports.AudioInvalidoError = AudioInvalidoError;
