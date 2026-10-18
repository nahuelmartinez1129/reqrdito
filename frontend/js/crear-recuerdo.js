document.addEventListener("DOMContentLoaded", () => {
  let mimeType = "audio/webm";

if (window.MediaRecorder) {
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    mimeType = "audio/mp4";
  } else if (MediaRecorder.isTypeSupported("audio/webm")) {
    mimeType = "audio/webm";
  }
}

console.log("Formato usado:", mimeType);
  let mediaRecorder;
  let audioChunks = [];
  window.audioBlob1 = null;
  window.audioBlob2 = null;

  const params = new URLSearchParams(window.location.search);
  const keychainKey = params.get("key");
  const packKeychain = params.get("pack");
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  
  const audio1 = document.getElementById("audio1");
  
  

  const animacionGrabando1 = document.getElementById("animacionGrabando1");
  const audio2 = document.getElementById("audio2");
  

  const animacionGrabando2 = document.getElementById("animacionGrabando2");
  const preview1 = document.getElementById("preview1");
  const preview2 = document.getElementById("preview2");
  const grupoAudio2 = document.getElementById("grupoAudio2");
  const btnContinuar = document.getElementById("btnContinuar");
  const estado = document.getElementById("estado");
  const loginModal = document.getElementById("loginModal");
  const btnCancelar = document.getElementById("btnCancelar");
  const loginEstado = document.getElementById("loginEstado");

  // Login con Google dentro de la página: el botón se renderiza en el modal y el
  // inicio de sesión es por ventana emergente, así que lo cargado (nombre, pack,
  // archivos y grabaciones) sigue en memoria. Al iniciar sesión se continúa solo.
  let continuarTrasLogin = false;
  auth.initLoginModal("loginModal", "googleBtn");

  document.addEventListener("loginSuccess", () => {
    if (!continuarTrasLogin) return;
    continuarTrasLogin = false;
    estado.textContent = "✅ Sesión iniciada. Guardando tu recuerdo...";
    btnContinuar.click();
  });

  function pedirLogin(mensaje){
    continuarTrasLogin = true;
    loginEstado.textContent = mensaje || "";
    loginModal.classList.add("is-active");
  }
  

  let pack = "individual";

  // =========================
  // BLOQUEAR PACK SI VIENE DE LLAVERO
  // =========================
  if(packKeychain){

    pack = packKeychain;

    document.querySelectorAll(".pack-btn").forEach(btn => {

      btn.classList.remove("active");

      if(btn.dataset.pack === packKeychain){
        btn.classList.add("active");
      }

      btn.disabled = true;

    });

    grupoAudio2.classList.toggle("oculto", packKeychain === "individual");

  }

  console.log("🚀 Crear recuerdo JS cargado");

  // =========================
  // PACK
  // =========================
  document.querySelectorAll(".pack-btn").forEach(btn => {

    btn.addEventListener("click", () => {

      if(packKeychain) return;

      document.querySelectorAll(".pack-btn").forEach(b => b.classList.remove("active"));

      btn.classList.add("active");

      pack = btn.dataset.pack;

      grupoAudio2.classList.toggle("oculto", pack === "individual");

    });

  });

  // Desde los precios de la landing (?tipo=individual|pareja): viene elegido, se puede cambiar
  const tipoElegido = params.get("tipo");
  if (!packKeychain && ["individual", "pareja"].includes(tipoElegido)) {
    document.querySelector(`.pack-btn[data-pack="${tipoElegido}"]`).click();
  }

  // =========================
  // PREVIEW AUDIO
  // =========================
  function preview(input, audio){

    input.addEventListener("change", () => {

      const file = input.files[0];

      if(!file) return;

      if(file.size > 10 * 1024 * 1024){

        alert("El audio supera los 10MB");

        input.value = "";

        return;

      }

      audio.src = URL.createObjectURL(file);

      audio.load();

    });

  }


  preview(audio1, preview1);
  preview(audio2, preview2);

 audio1.addEventListener("change", () => {
  audioBlob1 = null;
  estado.textContent = "";
});
  
audio2.addEventListener("change", () => {
  audioBlob2 = null;
  estado.textContent = "";
});

  // =========================
  // PERSONALIZACIÓN (opcional): fotos, mensaje, fecha y canción
  // =========================
  const foto = document.getElementById("foto");
  const fotosLista = document.getElementById("fotosLista");
  const fotosContador = document.getElementById("fotosContador");
  const fotoBoton = document.getElementById("fotoBoton");
  const mensajeTexto = document.getElementById("mensajeTexto");
  const mensajeContador = document.getElementById("mensajeContador");
  const fecha = document.getElementById("fecha");
  const fechaTitulo = document.getElementById("fechaTitulo");
  const fechaPreview = document.getElementById("fechaPreview");
  const cancion = document.getElementById("cancion");
  const cancionAyuda = document.getElementById("cancionAyuda");
  const AYUDA_FECHA = fechaPreview.textContent;
  const AYUDA_CANCION = cancionAyuda.textContent;
  const MAX_FOTOS = 4;
  // Fotos elegidas, en el orden en que se van a mostrar: { blob, url }
  const fotos = [];

  // Achica la foto a 1600 px como máximo y la pasa a JPEG: sube rápido con datos
  // móviles y el navegador ya aplica la orientación del celular. Sin canvas, va la original.
  async function prepararFoto(file) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * escala);
      canvas.height = Math.round(bitmap.height * escala);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // PNG con transparencia: fondo blanco
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
      return blob || file;
    } catch {
      return file;
    }
  }

  // Miniaturas numeradas con botón para quitar cada una
  function mostrarFotos() {
    fotosLista.textContent = "";
    fotos.forEach((f, i) => {
      const item = document.createElement("li");
      const img = document.createElement("img");
      img.src = f.url;
      img.alt = `Foto ${i + 1}`;
      const numero = document.createElement("span");
      numero.className = "fotos-numero";
      numero.textContent = i + 1;
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.className = "fotos-quitar";
      quitar.setAttribute("aria-label", `Quitar la foto ${i + 1}`);
      quitar.textContent = "×";
      quitar.addEventListener("click", () => {
        URL.revokeObjectURL(f.url);
        fotos.splice(fotos.indexOf(f), 1);
        mostrarFotos();
      });
      item.append(img, numero, quitar);
      fotosLista.append(item);
    });
    const quedan = MAX_FOTOS - fotos.length;
    fotosContador.textContent = fotos.length
      ? `${fotos.length} de ${MAX_FOTOS} fotos${quedan ? ` · podés sumar ${quedan} más` : ""}`
      : `Hasta ${MAX_FOTOS} fotos. Si elegís más de una, se van pasando solas.`;
    fotoBoton.classList.toggle("oculto", quedan === 0);
    fotoBoton.querySelector("span").textContent = fotos.length ? "Agregar más fotos" : "Elegir fotos";
    actualizarBotonSiguiente();
  }

  // Se pueden elegir varias a la vez, y volver a abrir el selector para sumar más
  foto.addEventListener("change", async () => {
    const elegidas = [...foto.files];
    foto.value = "";
    if (!elegidas.length) return;
    estado.textContent = "";

    const lugar = MAX_FOTOS - fotos.length;
    if (elegidas.length > lugar) {
      estado.textContent = `⚠️ Se pueden subir hasta ${MAX_FOTOS} fotos: agregamos las primeras ${lugar}`;
    }

    for (const file of elegidas.slice(0, lugar)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        estado.textContent = "⚠️ Las fotos tienen que ser JPG, PNG o WebP";
        continue;
      }
      const blob = await prepararFoto(file);
      if (blob.size > 10 * 1024 * 1024) {
        estado.textContent = "⚠️ Una foto supera los 10 MB y no se agregó";
        continue;
      }
      fotos.push({ blob, url: URL.createObjectURL(blob) });
    }
    mostrarFotos();
  });

  mensajeTexto.addEventListener("input", () => {
    mensajeContador.textContent = `${mensajeTexto.value.length} / 600`;
  });

  // Vista previa del contador con la fecha elegida
  function actualizarFecha() {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.value);
    if (!m) { fechaPreview.textContent = AYUDA_FECHA; return; }
    const elegida = new Date(+m[1], m[2] - 1, +m[3]);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (elegida > hoy) {
      const dias = Math.round((elegida - hoy) / 864e5);
      fechaPreview.textContent = `Se va a ver: «Faltan ${dias} ${dias === 1 ? "día" : "días"}», con cuenta regresiva.`;
      return;
    }
    const d = RecuerdoVista.diferencia(elegida, hoy);
    const partes = [
      d.anios && `${d.anios} ${d.anios === 1 ? "año" : "años"}`,
      d.meses && `${d.meses} ${d.meses === 1 ? "mes" : "meses"}`,
      d.dias && `${d.dias} ${d.dias === 1 ? "día" : "días"}`
    ].filter(Boolean);
    const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const fechaLarga = `${elegida.getDate()} de ${MESES[elegida.getMonth()]} de ${elegida.getFullYear()}`;
    fechaPreview.textContent = partes.length
      ? `Se va a ver: «${fechaTitulo.value} el ${fechaLarga}: ${partes.join(", ").replace(/, ([^,]*)$/, " y $1")}», contando en vivo.`
      : "Se va a ver: «¡Es hoy!»";
  }
  fecha.addEventListener("input", actualizarFecha);
  fechaTitulo.addEventListener("change", actualizarFecha);

  // Mismo criterio que el backend (utils/cancion.js), solo para avisar antes de subir
  function cancionValida(texto) {
    try {
      const u = new URL(texto);
      const host = u.hostname.replace(/^(www|m)\./, "");
      return ["open.spotify.com", "youtube.com", "music.youtube.com", "youtu.be"].includes(host);
    } catch {
      return false;
    }
  }

  cancion.addEventListener("input", () => {
    const texto = cancion.value.trim();
    cancion.classList.toggle("invalido", Boolean(texto) && !cancionValida(texto));
    cancionAyuda.textContent = texto && !cancionValida(texto)
      ? "⚠️ Tiene que ser un link de Spotify o YouTube"
      : AYUDA_CANCION;
  });

  // =========================
  // ASISTENTE POR PASOS
  // 1 tipo · 2 audios · 3 nombre y mensaje · 4 foto · 5 fecha · 6 canción · 7 revisión
  // Con llavero el tipo ya viene fijado: se empieza en el paso 2.
  // =========================
  const pasos = [...document.querySelectorAll(".paso")];
  const TOTAL = pasos.length;
  const PRIMER_PASO = packKeychain ? 2 : 1;
  const btnAtras = document.getElementById("btnAtras");
  const btnSiguiente = document.getElementById("btnSiguiente");
  const pasoNumero = document.getElementById("pasoNumero");
  const pasoNombre = document.getElementById("pasoNombre");
  const pasoBarra = document.getElementById("pasoBarra");
  const resumen = document.getElementById("resumen");
  const card = document.querySelector(".crear-card");
  let pasoActual = PRIMER_PASO;

  function paso(n) {
    return pasos[n - 1];
  }

  // Pasos opcionales sin completar: el botón dice "Saltar este paso"
  function pasoVacio(n) {
    if (n === 4) return fotos.length === 0;
    if (n === 5) return !fecha.value;
    if (n === 6) return !cancion.value.trim();
    return false;
  }

  // Lo que falta o está mal en un paso; null si se puede seguir
  function errorDelPaso(n) {
    if (n === 2) {
      if (!audio1.files[0] && !window.audioBlob1) return "⚠️ Falta el audio principal";
      if (pack === "pareja" && !audio2.files[0] && !window.audioBlob2) return "⚠️ Falta el segundo audio";
    }
    if (n === 3) {
      const nombre = document.getElementById("nombre").value.trim();
      if (!nombre) return "⚠️ Escribí un nombre para tu recuerdo";
      if (nombre.length > 120) return "⚠️ El nombre es demasiado largo (máximo 120 caracteres)";
    }
    if (n === 6) {
      const texto = cancion.value.trim();
      if (texto && !cancionValida(texto)) return "⚠️ El link de la canción tiene que ser de Spotify o YouTube";
    }
    return null;
  }

  function actualizarBotonSiguiente() {
    btnSiguiente.textContent = paso(pasoActual).hasAttribute("data-opcional") && pasoVacio(pasoActual)
      ? "Saltar este paso"
      : "Siguiente";
  }

  function mostrarPaso(n, { desplazar = true } = {}) {
    pasoActual = n;
    pasos.forEach(p => { p.hidden = Number(p.dataset.paso) !== n; });

    const visibles = TOTAL - PRIMER_PASO + 1;
    const indice = n - PRIMER_PASO + 1;
    pasoNumero.textContent = `Paso ${indice} de ${visibles}`;
    pasoNombre.textContent = paso(n).dataset.nombre;
    pasoBarra.style.width = `${(indice / visibles) * 100}%`;

    btnAtras.hidden = n === PRIMER_PASO;
    btnSiguiente.hidden = n === TOTAL;
    estado.textContent = "";
    actualizarBotonSiguiente();
    if (n === TOTAL) armarResumen();

    if (desplazar) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  btnSiguiente.addEventListener("click", () => {
    const error = errorDelPaso(pasoActual);
    if (error) { estado.textContent = error; return; }
    mostrarPaso(pasoActual + 1);
  });

  btnAtras.addEventListener("click", () => {
    if (pasoActual > PRIMER_PASO) mostrarPaso(pasoActual - 1);
  });

  // Enter en un campo = Siguiente (el formulario nunca se envía solo)
  document.querySelector("form.wizard").addEventListener("submit", e => {
    e.preventDefault();
    if (pasoActual < TOTAL) btnSiguiente.click();
  });

  [fecha, cancion].forEach(campo => {
    campo.addEventListener("input", actualizarBotonSiguiente);
    campo.addEventListener("change", actualizarBotonSiguiente);
  });

  // Resumen del último paso (todo como texto: nada de lo cargado se interpreta como HTML)
  function armarResumen() {
    resumen.textContent = "";
    const fechaElegida = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.value);
    const texto = cancion.value.trim();
    const filas = [
      [1, "Tipo", pack === "pareja" ? "Dúo · 2 audios" : "Individual · 1 audio"],
      [2, "Audios", pack === "pareja" ? "2 audios listos" : "1 audio listo"],
      [3, "Nombre", document.getElementById("nombre").value.trim()],
      [3, "Mensaje", mensajeTexto.value.trim() || "Sin mensaje"],
      [4, "Fotos", fotos.length ? "" : "Sin fotos"],
      [5, "Fecha", fechaElegida
        ? `${fechaTitulo.value} el ${+fechaElegida[3]}/${+fechaElegida[2]}/${fechaElegida[1]}`
        : "Sin fecha"],
      [6, "Canción", texto ? (/spotify/i.test(texto) ? "Spotify ✓" : "YouTube ✓") : "Sin canción"]
    ];

    for (const [n, titulo, valor] of filas) {
      if (n < PRIMER_PASO) continue;
      const li = document.createElement("li");
      const etiqueta = document.createElement("span");
      etiqueta.className = "resumen-etiqueta";
      etiqueta.textContent = titulo;
      const dato = document.createElement("span");
      dato.className = "resumen-valor";
      if (titulo === "Fotos" && fotos.length) {
        dato.classList.add("resumen-fotos");
        fotos.forEach((f, i) => {
          const img = document.createElement("img");
          img.src = f.url;
          img.alt = `Foto ${i + 1}`;
          dato.append(img);
        });
      } else {
        dato.textContent = valor;
      }
      const cambiar = document.createElement("button");
      cambiar.type = "button";
      cambiar.className = "resumen-cambiar";
      cambiar.textContent = "Cambiar";
      cambiar.addEventListener("click", () => mostrarPaso(n));
      li.append(etiqueta, dato, cambiar);
      resumen.append(li);
    }
  }

  mostrarPaso(PRIMER_PASO, { desplazar: false });

  // =========================
  // CONTINUAR
  // =========================
  btnContinuar.addEventListener("click", async () => {

    estado.textContent = "";

    // Si algo falta (p. ej. tras "Cambiar" desde el resumen), se vuelve a ese paso
    for (const n of [2, 3, 6]) {
      const error = errorDelPaso(n);
      if (error) {
        mostrarPaso(n);
        estado.textContent = error;
        return;
      }
    }

    const nombre = document.getElementById("nombre").value.trim();

    // el backend exige sesión también para activar llaveros
    if(!auth.isLogged()){

      pedirLogin();

      return;

    }

    btnContinuar.disabled = true;

    try{

      estado.textContent = "Guardando tu recuerdo...";

      const formData = new FormData();

      formData.append("nombre", nombre);
      formData.append("pack", pack);

      // personalización opcional: solo lo que se completó
      fotos.forEach((f, i) => formData.append("foto", f.blob, `foto${i + 1}.jpg`));
      if(mensajeTexto.value.trim()) formData.append("mensaje", mensajeTexto.value.trim());
      if(fecha.value){
        formData.append("fecha", fecha.value);
        formData.append("fechaTitulo", fechaTitulo.value);
      }
      if(cancion.value.trim()) formData.append("cancion", cancion.value.trim());
      if(audio1.files[0]){
  formData.append("audio1", audio1.files[0]);
} else if(audioBlob1){
  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  formData.append("audio1", audioBlob1, `grabacion.${extension}`);
}
      if(pack === "pareja"){

  if(audio2.files[0]){
    formData.append("audio2", audio2.files[0]);

  } else if(audioBlob2){
  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  formData.append("audio2", audioBlob2, `grabacion2.${extension}`);
}

}

      const url = keychainKey
        ? `${REQRDITO.API}/api/upload?key=${encodeURIComponent(keychainKey)}`
        : `${REQRDITO.API}/api/upload`;

      const token = auth.getToken() || localStorage.getItem("token");

      const res = await fetch(url,{
          method:"POST",
          headers:{
            Authorization:`Bearer ${token}`
          },
          body:formData
        });

        // sesión vencida: se vuelve a pedir el login sin salir de la página
        if (res.status === 401) {
          auth.clearToken();
          estado.textContent = "";
          btnContinuar.disabled = false;
          pedirLogin("Tu sesión venció. Iniciá sesión de nuevo: lo que cargaste no se pierde.");
          return;
        }

      const data = await res.json().catch(() => ({}));

      if(!res.ok || !data.id){
        // mensajes del backend (archivo inválido, demasiado grande, llavero usado...)
        throw new Error(data.error || "Error creando recuerdo");
      }

      if(keychainKey){

        window.location.href = `recuerdo.html?id=${data.id}`;

      }else{

        window.location.href = `pago.html?id=${data.id}`;

      }

    }catch(err){

      console.error(err);

      estado.textContent = `❌ ${err.message || "Error creando recuerdo"}`;

      btnContinuar.disabled = false;

    }

  });

  btnCancelar.addEventListener("click", () => {

    continuarTrasLogin = false;

    loginModal.classList.remove("is-active");

    estado.textContent = "Iniciá sesión cuando quieras continuar: lo que cargaste sigue acá.";

  });

});

// =========================
// 🎤 GRABAR AUDIO 1
// =========================

let recorder1;
let chunks1 = [];
let stream1;
let recorder2;
let chunks2 = [];
let stream2;
async function grabarAudio1() {
  try {
    stream1 = await navigator.mediaDevices.getUserMedia({ audio: true });

    let options = {};

    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      options.mimeType = "audio/mp4";
    }

    recorder1 = new MediaRecorder(stream1, options);

    recorder1.start();
    chunks1 = [];

    document.getElementById("recIndicator1").classList.remove("hidden");

    recorder1.ondataavailable = e => {
      chunks1.push(e.data);
    };

    console.log("🎤 Grabando audio 1...");

  } catch (err) {
    console.error("Error al grabar:", err);
    alert("No se pudo acceder al micrófono");
  }
}


// =========================
// ⏹️ DETENER AUDIO 1
// =========================

function detenerAudio1() {
  if (!recorder1) return;

  recorder1.stop();

  document.getElementById("recIndicator1").classList.add("hidden");

  recorder1.onstop = () => {
    const blob = new Blob(chunks1, { type: recorder1.mimeType });
    const preview1 = document.getElementById("preview1");

    preview1.src = URL.createObjectURL(blob);
    preview1.load();

    // 🔥 MUY IMPORTANTE
    window.audioBlob1 = blob;
    document.getElementById("estado").textContent = "";

    // 🔥 LIBERAR MICRÓFONO
if (stream1) {
  stream1.getTracks().forEach(track => track.stop());
}

    console.log("✅ Audio listo");
  };
}

async function grabarAudio2() {
  try {
    stream2 = await navigator.mediaDevices.getUserMedia({ audio: true });

    let options = {};

    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      options.mimeType = "audio/mp4";
    }

    recorder2 = new MediaRecorder(stream2, options);

    recorder2.start();
    chunks2 = [];

    document.getElementById("recIndicator2").classList.remove("hidden");

    recorder2.ondataavailable = e => {
      chunks2.push(e.data);
    };

    console.log("🎤 Grabando audio 2...");

  } catch (err) {
    console.error("Error al grabar audio2:", err);
    alert("No se pudo acceder al micrófono");
  }
}

function detenerAudio2() {
  if (!recorder2) return;

  recorder2.stop();

  document.getElementById("recIndicator2").classList.add("hidden");

  recorder2.onstop = () => {
    const blob = new Blob(chunks2, { type: recorder2.mimeType });
    const preview2 = document.getElementById("preview2");

    preview2.src = URL.createObjectURL(blob);
    preview2.load();

    // 🔥 MUY IMPORTANTE
    window.audioBlob2 = blob;
    document.getElementById("estado").textContent = "";

    if (stream2) {
  stream2.getTracks().forEach(track => track.stop());
}

    console.log("✅ Audio 2 listo");
  };
}