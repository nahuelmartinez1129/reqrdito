// Canción de un recuerdo: solo links de Spotify o YouTube.
// Se guarda la forma canónica (nunca la URL tal cual la pegó la persona) y el
// frontend arma el reproductor incrustado a partir de ella (js/recuerdo-vista.js).

const SPOTIFY_TIPOS = ["track", "album", "playlist", "episode"];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * @param {string} texto - link pegado por la persona
 * @returns {string|null} URL canónica o null si no es un link válido de Spotify o YouTube
 */
function normalizarCancion(texto) {
  if (typeof texto !== "string") return null;
  let url;
  try {
    url = new URL(texto.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const partes = url.pathname.split("/").filter(Boolean);

  if (host === "open.spotify.com") {
    // /track/<id> o /intl-es/track/<id>
    if (partes[0] && /^intl-[a-z-]+$/i.test(partes[0])) partes.shift();
    const [tipo, id] = partes;
    return SPOTIFY_TIPOS.includes(tipo) && SPOTIFY_ID.test(id || "")
      ? `https://open.spotify.com/${tipo}/${id}`
      : null;
  }

  let id = null;
  if (host === "youtu.be") {
    id = partes[0];
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    if (partes[0] === "watch") id = url.searchParams.get("v");
    else if (partes[0] === "shorts" || partes[0] === "embed" || partes[0] === "live") id = partes[1];
  }
  return YOUTUBE_ID.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : null;
}

module.exports = { normalizarCancion };
