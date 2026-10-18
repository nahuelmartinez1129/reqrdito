// Página de un recuerdo (lo que se ve al escanear el QR): fotos, nombre, contador de
// tiempo, mensaje, audios y canción. La usan recuerdo.html y ejemplo.html.
//   RecuerdoVista.mostrar(contenedor, datos, { base })
// `datos` tiene el formato de GET /api/recuerdo/:id; `base` antepone la dirección de la
// API a las rutas de archivos (/audio/..., /foto/...).
// Todo lo que cargó la persona se inserta como texto (textContent), nunca como HTML.
(function () {
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];
  var DIA_MS = 864e5;

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function plural(n, uno, varios) {
    return n + " " + (n === 1 ? uno : varios);
  }

  function lista(partes) {
    partes = partes.filter(Boolean);
    if (partes.length <= 1) return partes.join("");
    return partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
  }

  // "AAAA-MM-DD" → medianoche local de ese día
  function leerFecha(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function fechaLarga(d) {
    return d.getDate() + " de " + MESES[d.getMonth()] + " de " + d.getFullYear();
  }

  // Años, meses y días completos entre dos fechas (desde <= hasta)
  function diferencia(desde, hasta) {
    var anios = hasta.getFullYear() - desde.getFullYear();
    var meses = hasta.getMonth() - desde.getMonth();
    var dias = hasta.getDate() - desde.getDate();
    if (dias < 0) {
      meses--;
      dias += new Date(hasta.getFullYear(), hasta.getMonth(), 0).getDate();
    }
    if (meses < 0) { anios--; meses += 12; }
    return { anios: anios, meses: meses, dias: dias };
  }

  function reloj(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600) % 24, min = Math.floor(s / 60) % 60, seg = s % 60;
    var dos = function (n) { return (n < 10 ? "0" : "") + n; };
    return dos(h) + " h " + dos(min) + " min " + dos(seg) + " s";
  }

  /* ---------- Contador ---------- */
  function contador(datos) {
    var fecha = leerFecha(datos.fecha);
    if (!fecha) return null;

    var caja = el("section", "rv-contador");
    caja.setAttribute("aria-live", "off");
    var titulo = el("p", "rv-contador-titulo", (datos.fechaTitulo || "Desde") + " el " + fechaLarga(fecha));
    var grande = el("p", "rv-contador-grande");
    var vivo = el("p", "rv-contador-vivo");
    var proximo = el("p", "rv-contador-proximo");
    caja.append(titulo, grande, vivo, proximo);

    function actualizar() {
      var ahora = new Date();
      var hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
      var ms = ahora - fecha;

      if (ms < 0) {
        // Fecha futura: cuenta regresiva
        var faltan = Math.ceil((fecha - hoy) / DIA_MS);
        grande.textContent = "Faltan " + plural(faltan, "día", "días");
        vivo.textContent = reloj(-ms);
        proximo.textContent = "";
        return;
      }

      var d = diferencia(fecha, hoy);
      var dias = Math.round((hoy - fecha) / DIA_MS);
      grande.textContent = dias === 0
        ? "¡Es hoy!"
        : lista([d.anios && plural(d.anios, "año", "años"), d.meses && plural(d.meses, "mes", "meses"),
            d.dias && plural(d.dias, "día", "días")]);
      vivo.textContent = dias.toLocaleString("es-AR") + (dias === 1 ? " día" : " días") + " · " + reloj(ms);

      // Próximo aniversario de la fecha
      var cumple = new Date(hoy.getFullYear(), fecha.getMonth(), fecha.getDate());
      if (cumple < hoy) cumple.setFullYear(hoy.getFullYear() + 1);
      var faltanCumple = Math.round((cumple - hoy) / DIA_MS);
      var numero = cumple.getFullYear() - fecha.getFullYear();
      proximo.textContent = numero < 1 ? "" : faltanCumple === 0
        ? "🎉 ¡Hoy se cumplen " + plural(numero, "año", "años") + "!"
        : "Faltan " + plural(faltanCumple, "día", "días") + " para cumplir " + plural(numero, "año", "años") + " 🎉";
    }

    actualizar();
    setInterval(actualizar, 1000);
    return caja;
  }

  /* ---------- Canción (Spotify / YouTube) ---------- */
  // Solo la forma canónica que guarda el backend (utils/cancion.js)
  function reproductorCancion(url) {
    var sp = /^https:\/\/open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]{22})$/.exec(url || "");
    var yt = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(url || "");
    if (!sp && !yt) return null;

    var caja = el("section", "rv-cancion");
    caja.append(el("h2", "rv-subtitulo", "🎵 Nuestra canción"));
    var frame = document.createElement("iframe");
    frame.loading = "lazy";
    frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    if (sp) {
      frame.src = "https://open.spotify.com/embed/" + sp[1] + "/" + sp[2] + "?utm_source=reqrdito";
      frame.title = "Canción en Spotify";
      frame.className = "rv-spotify";
      frame.height = sp[1] === "track" || sp[1] === "episode" ? "152" : "352";
    } else {
      frame.src = "https://www.youtube-nocookie.com/embed/" + yt[1];
      frame.title = "Canción en YouTube";
      frame.className = "rv-youtube";
      frame.allowFullscreen = true;
    }
    caja.append(frame);
    return caja;
  }

  /* ---------- Fotos: polaroid que pasa sola (fundido + zoom lento) ---------- */
  var INTERVALO_FOTOS_MS = 4500;

  function carrusel(urls, base) {
    var marco = el("figure", "rv-foto");
    var pista = el("div", "rv-fotos");
    var imgs = urls.map(function (url, i) {
      var img = document.createElement("img");
      img.src = base + url;
      img.alt = urls.length > 1 ? "Foto " + (i + 1) + " de " + urls.length : "Foto del recuerdo";
      img.decoding = "async";
      if (i === 0) img.className = "activa";
      pista.append(img);
      return img;
    });
    marco.append(pista);
    if (urls.length < 2) return marco;

    var actual = 0;
    var puntos = el("div", "rv-fotos-puntos");
    var botones = urls.map(function (_, i) {
      var b = el("button", i === 0 ? "activo" : "");
      b.type = "button";
      b.setAttribute("aria-label", "Ver foto " + (i + 1));
      b.addEventListener("click", function (e) { e.stopPropagation(); ir(i); reiniciar(); });
      puntos.append(b);
      return b;
    });
    marco.append(puntos);

    function ir(i) {
      actual = (i + urls.length) % urls.length;
      imgs.forEach(function (img, j) {
        // reinicia el zoom de la que entra
        if (j === actual) { img.classList.remove("activa"); void img.offsetWidth; img.classList.add("activa"); }
        else img.classList.remove("activa");
      });
      botones.forEach(function (b, j) { b.classList.toggle("activo", j === actual); });
    }

    // Con "reducir movimiento" no pasan solas: se cambian tocando
    var quieto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var timer = null;
    function reiniciar() {
      clearInterval(timer);
      if (!quieto) timer = setInterval(function () { if (!document.hidden) ir(actual + 1); }, INTERVALO_FOTOS_MS);
    }
    reiniciar();

    // Tocar la foto = siguiente; deslizar = siguiente / anterior
    var inicioX = null;
    pista.addEventListener("pointerdown", function (e) { inicioX = e.clientX; });
    pista.addEventListener("pointerup", function (e) {
      if (inicioX === null) return;
      var dx = e.clientX - inicioX;
      inicioX = null;
      ir(Math.abs(dx) > 40 && dx > 0 ? actual - 1 : actual + 1);
      reiniciar();
    });
    pista.setAttribute("role", "group");
    pista.setAttribute("aria-label", "Fotos del recuerdo: tocá para pasar a la siguiente");
    return marco;
  }

  /* ---------- Audios ---------- */
  function reproductorAudios(urls, base) {
    if (!urls.length) return null;
    var caja = el("section", "rv-audio");
    caja.append(
      el("h2", "rv-subtitulo", urls.length > 1 ? "🎧 Te dejaron dos mensajes" : "🎧 Te dejaron un mensaje"),
      el("p", "rv-ayuda", "Buscá un lugar tranquilo y subí el volumen.")
    );
    var indice = 0;
    var audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.className = "recuerdo-audio";
    audio.src = base + urls[0];
    audio.onended = function () {
      indice++;
      if (urls[indice]) { audio.src = base + urls[indice]; audio.play(); }
    };
    caja.append(audio);
    return caja;
  }

  function mostrar(contenedor, datos, opciones) {
    var base = (opciones && opciones.base) || "";
    contenedor.textContent = "";

    var urls = (datos.audios || []).slice()
      .sort(function (a, b) { return a.orden - b.orden; })
      .map(function (a) { return a.url; })
      .filter(Boolean);

    var fotos = (datos.fotos || []).slice()
      .sort(function (a, b) { return a.orden - b.orden; })
      .map(function (f) { return f.url; })
      .filter(Boolean);
    if (fotos.length) contenedor.append(carrusel(fotos, base));

    contenedor.append(el("h1", "rv-nombre", datos.nombre || "Un recuerdo para vos"));

    var partes = [
      contador(datos),
      datos.mensaje ? el("p", "rv-mensaje", datos.mensaje) : null,
      reproductorAudios(urls, base),
      reproductorCancion(datos.cancionUrl)
    ];
    partes.forEach(function (p) { if (p) contenedor.append(p); });
  }

  window.RecuerdoVista = { mostrar: mostrar, diferencia: diferencia };
})();
