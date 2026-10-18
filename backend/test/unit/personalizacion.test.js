// Personalización del recuerdo: canción (Spotify / YouTube), fecha, mensaje y formato de foto.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { normalizarCancion } = require("../../utils/cancion");
const { personalizacion } = require("../../utils/personalizacion");
const { esImagenAceptada } = require("../../utils/convertirImagen");

test("canción: links de Spotify y YouTube quedan en forma canónica", () => {
  const ID = "4uLU6hMCjMI75M1A2tKUQC";
  assert.equal(normalizarCancion(`https://open.spotify.com/track/${ID}?si=abc123`), `https://open.spotify.com/track/${ID}`);
  assert.equal(normalizarCancion(`https://open.spotify.com/intl-es/track/${ID}`), `https://open.spotify.com/track/${ID}`);
  assert.equal(normalizarCancion(`https://open.spotify.com/playlist/${ID}`), `https://open.spotify.com/playlist/${ID}`);
  assert.equal(normalizarCancion("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(normalizarCancion("https://youtu.be/dQw4w9WgXcQ?si=x"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(normalizarCancion("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(normalizarCancion("  https://music.youtube.com/watch?v=dQw4w9WgXcQ  "), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("canción: cualquier otra cosa se rechaza", () => {
  for (const malo of [
    "https://evil.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com.evil.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com/artist/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com/track/corto",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=<script>",
    "https://youtube.com/@canal",
    "no es un link",
    "", null, 42
  ]) {
    assert.equal(normalizarCancion(malo), null, String(malo));
  }
});

test("personalización: todo vacío es válido y no guarda nada", () => {
  assert.deepEqual(personalizacion({}), { datos: { mensaje: null, fecha: null, fechaTitulo: null, cancionUrl: null } });
});

test("personalización: fecha y título, mensaje y canción", () => {
  const { datos } = personalizacion({
    mensaje: "  Te quiero  ", fecha: "2023-03-15", fechaTitulo: "Juntos desde",
    cancion: "https://youtu.be/dQw4w9WgXcQ"
  });
  assert.equal(datos.mensaje, "Te quiero");
  assert.equal(datos.fecha.toISOString(), "2023-03-15T00:00:00.000Z");
  assert.equal(datos.fechaTitulo, "Juntos desde");
  assert.equal(datos.cancionUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  // título por defecto; un título sin fecha no se guarda
  assert.equal(personalizacion({ fecha: "2020-01-01" }).datos.fechaTitulo, "Desde");
  assert.equal(personalizacion({ fechaTitulo: "Juntos desde" }).datos.fechaTitulo, null);
});

test("personalización: rechaza fechas inexistentes, textos largos y canciones ajenas", () => {
  for (const fecha of ["2023-02-30", "15/03/2023", "1800-01-01", "2023-13-01", "hoy"]) {
    assert.match(personalizacion({ fecha }).error, /fecha/, fecha);
  }
  assert.match(personalizacion({ mensaje: "x".repeat(601) }).error, /mensaje/);
  assert.match(personalizacion({ fecha: "2020-01-01", fechaTitulo: "x".repeat(61) }).error, /título/);
  assert.match(personalizacion({ cancion: "https://soundcloud.com/x" }).error, /Spotify o YouTube/);
});

test("foto: solo firmas de JPEG, PNG o WebP", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqrdito-foto-"));
  const archivo = (nombre, bytes) => { const p = path.join(dir, nombre); fs.writeFileSync(p, Buffer.from(bytes)); return p; };
  try {
    assert.equal(esImagenAceptada(archivo("a.jpg", [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
    assert.equal(esImagenAceptada(archivo("a.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), true);
    assert.equal(esImagenAceptada(archivo("a.webp", [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), true);
    assert.equal(esImagenAceptada(archivo("a.svg", [...Buffer.from("<svg xmlns=")])), false);
    assert.equal(esImagenAceptada(archivo("a.gif", [...Buffer.from("GIF89a"), 0, 0, 0, 0, 0, 0])), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
