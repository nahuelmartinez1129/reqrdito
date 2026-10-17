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
});
  
audio2.addEventListener("change", () => {
  audioBlob2 = null;
});

  // =========================
  // CONTINUAR
  // =========================
  btnContinuar.addEventListener("click", async () => {

    estado.textContent = "";

    const nombre = document.getElementById("nombre").value.trim();

    if(!nombre){

      estado.textContent = "⚠️ Escribí un nombre para tu recuerdo";

      return;

    }

    if(nombre.length > 120){

      estado.textContent = "⚠️ El nombre es demasiado largo (máximo 120 caracteres)";

      return;

    }

    if(!audio1.files[0] && !audioBlob1){

      estado.textContent = "⚠️ Falta el audio principal";

      return;

    }

    if(pack === "pareja" && !audio2.files[0] && !audioBlob2){

      estado.textContent = "⚠️ Falta el segundo audio";

      return;

    }

    // el backend exige sesión también para activar llaveros
    if(!auth.isLogged()){

      pedirLogin();

      return;

    }

    btnContinuar.disabled = true;

    try{

      estado.textContent = "Subiendo audio...";

      const formData = new FormData();

      formData.append("nombre", nombre);
      formData.append("pack", pack);
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

    if (stream2) {
  stream2.getTracks().forEach(track => track.stop());
}

    console.log("✅ Audio 2 listo");
  };
}