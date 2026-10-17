// Formatos de respuesta de la API.
// Mantienen los nombres de campo que el frontend publicado ya consume
// (incluido `_id`, que antes era el ObjectId de MongoDB).

function ordenarAudios(audios = []) {
  return [...audios]
    .sort((a, b) => a.orden - b.orden)
    .map(a => ({ url: a.url, orden: a.orden }));
}

function serializarRecuerdo(r) {
  return {
    _id: r.id,
    recuerdoId: r.id,
    nombre: r.nombre,
    pack: r.pack,
    audios: ordenarAudios(r.audios),
    qrUrl: r.qrUrl,
    creadoEn: r.createdAt
  };
}

function serializarKeychain(k) {
  const audios = ordenarAudios(k.recuerdo?.audios);
  return {
    _id: k.qrId,
    qrId: k.qrId,
    pack: k.pack,
    usado: k.usado,
    recuerdoId: k.recuerdoId,
    nombreRecuerdo: k.recuerdo?.nombre ?? null,
    audioUrl: audios[0]?.url ?? null,
    escaneos: k.escaneos,
    activadoEn: k.activadoEn,
    creadoEn: k.createdAt
  };
}

function serializarEvento(e) {
  return {
    _id: e.id,
    id: e.id,
    name: e.name,
    userId: e.userId,
    date: e.createdAt
  };
}

function serializarEventQr(q) {
  return {
    _id: q.qrId,
    qrId: q.qrId,
    eventId: q.eventId,
    userId: q.event?.userId,
    userEmail: q.event?.user?.email,
    name: q.name,
    audioUrl: q.audioUrl,
    status: q.status,
    createdAt: q.createdAt
  };
}

module.exports = {
  ordenarAudios,
  serializarRecuerdo,
  serializarKeychain,
  serializarEvento,
  serializarEventQr
};
