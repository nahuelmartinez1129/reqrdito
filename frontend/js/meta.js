// Meta Pixel + API de conversiones para los eventos de navegación.
// Cada PageView / ViewContent sale por el pixel con un event_id aleatorio y el mismo
// evento se manda al backend (POST /api/meta/evento), que lo reenvía a Meta desde el
// servidor. Meta los cuenta una sola vez (mismo event_name + event_id) y registra
// también las visitas de navegadores que bloquean el pixel.
// InitiateCheckout y Purchase NO pasan por acá: el backend los manda al crear la
// preferencia y al confirmar el pago, con sus propios ids.
// Se carga en <head>, justo después del código base del pixel (fbq('init', ...)).
(function () {
  var REPLICADOS = { PageView: true, ViewContent: true };
  var pendientes = [];
  var cargada = document.readyState === "complete";

  function nuevoId(prefijo) {
    var aleatorio = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    return prefijo + "_" + aleatorio;
  }

  function cookie(nombre) {
    var par = document.cookie.split("; ").find(function (c) { return c.indexOf(nombre + "=") === 0; });
    return par ? decodeURIComponent(par.slice(nombre.length + 1)) : undefined;
  }

  // _fbc la crea el pixel al llegar desde un anuncio (?fbclid=). Si el pixel está
  // bloqueado, se arma con el formato de Meta: fb.1.<ms>.<fbclid>
  function fbc() {
    var c = cookie("_fbc");
    if (c) return c;
    var fbclid = new URLSearchParams(location.search).get("fbclid");
    return fbclid ? "fb.1." + Date.now() + "." + fbclid : undefined;
  }

  function enviarAlServidor(nombre, eventId) {
    var api = window.REQRDITO && window.REQRDITO.API;
    if (!api) return;
    try {
      fetch(api + "/api/meta/evento", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evento: nombre,
          eventId: eventId,
          url: location.href.split("#")[0],
          fbp: cookie("_fbp"),
          fbc: fbc()
        })
      }).catch(function () {});
    } catch (e) { /* sin fetch: queda solo el pixel */ }
  }

  // Al terminar de cargar la página el pixel ya creó la cookie _fbp (y config.js,
  // que va al final del body, ya definió la dirección de la API)
  function vaciarPendientes() {
    cargada = true;
    pendientes.splice(0).forEach(function (e) { enviarAlServidor(e[0], e[1]); });
  }
  if (!cargada) window.addEventListener("load", vaciarPendientes);

  function evento(nombre, datos) {
    var eventId = nuevoId(nombre === "PageView" ? "pv" : "ev");
    if (typeof window.fbq === "function") {
      window.fbq("track", nombre, datos || {}, { eventID: eventId });
    }
    if (REPLICADOS[nombre]) {
      if (cargada) enviarAlServidor(nombre, eventId);
      else pendientes.push([nombre, eventId]);
    }
  }

  window.reqrditoMeta = { evento: evento };
  evento("PageView");
})();
