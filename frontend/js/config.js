// Direcciones de la API y del sitio según dónde se abre el frontend.
// - En reqrdito.com: producción (https://api.reqrdito.com).
// - En localhost / 127.0.0.1: backend local (http://localhost:5000 por defecto;
//   se puede cambiar con localStorage.setItem("reqrditoApiLocal", "http://localhost:5001")).
// Se carga antes que cualquier otro script de la página.
(function () {
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var apiLocal = "http://localhost:5000";

  if (local) {
    try {
      var guardada = localStorage.getItem("reqrditoApiLocal");
      if (guardada && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(guardada)) apiLocal = guardada;
    } catch (e) { /* sin almacenamiento: se usa el puerto por defecto */ }
  }

  window.REQRDITO = Object.freeze({
    local: local,
    API: local ? apiLocal : "https://api.reqrdito.com",
    SITIO: local ? location.origin : "https://www.reqrdito.com"
  });
})();
