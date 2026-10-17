const id = new URLSearchParams(location.search).get("id");
const API = "https://api.reqrdito.com";
let selectedMicId = null;
let recorder, chunks = [];
let selectedQR = null;

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const status = document.getElementById("recordStatus");
const guestInput = document.getElementById("guestName");


async function elegirMicrofono() {
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
});
  const devices = await navigator.mediaDevices.enumerateDevices();

  const mics = devices.filter(d => d.kind === "audioinput");

  let texto = "";

  mics.forEach((mic, i) => {
    texto += `${i + 1}. ${mic.label || "Mic"} (${mic.deviceId})\n`;
  });

  const seleccion = prompt("Elegí mic:\n\n" + texto);

  const index = parseInt(seleccion) - 1;

  if (mics[index]) {
    selectedMicId = mics[index].deviceId;
    alert("Seleccionado: " + mics[index].label);
  }
}

/* =========================
   CARGAR EVENTO + QRs
========================= */
async function loadEvent() {
  try {
    const resEvent = await fetch(`${API}/events/${id}`);
    const event = await resEvent.json();

    document.getElementById("eventName").innerText = event.name;

    const resQR = await fetch(`${API}/events/${id}/qrs`);
    const qrs = await resQR.json();

    const container = document.getElementById("audios");
    container.innerHTML = "";

    if (!qrs || qrs.length === 0) {
      container.innerHTML = "<p>No hay QRs generados todavía ⚡</p>";
      return;
    }

    // 🔥 CONTADOR
    const total = qrs.length;
    const grabados = qrs.filter(q => q.status === "completed").length;

    document.getElementById("contador").innerText =
      `🎧 ${grabados} / ${total} recuerdos grabados`;

    qrs.forEach(q => {
      container.innerHTML += `
        <div class="audio-item ${q.qrId === selectedQR ? "active" : ""}"
             onclick="selectQR('${q.qrId}')">

          <b>${q.name || "Invitado"}</b>

          <div class="audio-row">
            ${
              q.audioUrl
                ? `<audio controls src="${q.audioUrl}"></audio>`
                : `<span>⏳ Sin grabar</span>`
            }

            <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${API}/events/r/${q.qrId}">
          </div>

          <p>Estado: ${q.status}</p>

          <button class="btn-delete" onclick="event.stopPropagation(); deleteQR('${q.qrId}')">
            🗑 Eliminar
          </button>
        </div>
      `;
    });

  } catch (err) {
    console.error("Error cargando evento:", err);
  }
}

/* =========================
   SELECCIONAR QR
========================= */
function selectQR(qrId) {
  selectedQR = qrId;

  const items = document.querySelectorAll(".audio-item");
  items.forEach(i => i.classList.remove("active"));

  const selected = document.querySelector(`[onclick="selectQR('${qrId}')"]`);
  if (selected) selected.classList.add("active");
}

/* =========================
   ELIMINAR QR
========================= */
async function deleteQR(qrId) {
  if (!confirm("¿Eliminar este QR?")) return;

  await fetch(`${API}/events/qr/${qrId}`, {
    method: "DELETE"
  });

  loadEvent();
}

/* =========================
   GRABAR AUDIO
========================= */
startBtn.onclick = async () => {
  if (!selectedQR) {
    alert("Seleccioná un QR primero");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

let options = {};

if (MediaRecorder.isTypeSupported("audio/mp4")) {
  options.mimeType = "audio/mp4";
}

recorder = new MediaRecorder(stream, options);

  recorder.start();
  chunks = [];
recorder.ondataavailable = e => {
  console.log("DATA SIZE:", e.data.size);
  chunks.push(e.data);
};
  recorder.ondataavailable = e => chunks.push(e.data);

  status.classList.remove("hidden");
  startBtn.classList.add("disabled");
  stopBtn.classList.remove("disabled");
};

/* =========================
   STOP AUDIO
========================= */
stopBtn.onclick = () => {
  if (!recorder) return;

  recorder.stop();

  status.classList.add("hidden");
  startBtn.classList.remove("disabled");
  stopBtn.classList.add("disabled");

  recorder.onstop = async () => {
const blob = new Blob(chunks);
    const fd = new FormData();
    fd.append("audio", blob);
    fd.append("name", guestInput.value || "Invitado");

    await fetch(`${API}/events/qr/${selectedQR}/audio`, {
      method: "POST",
      body: fd
    });

    guestInput.value = "";
    loadEvent();
  };
};

/* =========================
   GENERAR QRs
========================= */
async function generateQRs() {
  const cantidad = prompt("Cantidad de QRs:");
  if (!cantidad) return;

  await fetch(`${API}/events/${id}/generate-qrs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ cantidad })
  });

  loadEvent();
}

/* =========================
   INIT
========================= */
stopBtn.classList.add("disabled");
loadEvent();
const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];

  if (!file) return;

  if (!selectedQR) {
    alert("Seleccioná un QR primero");
    return;
  }

  const fd = new FormData();
  fd.append("audio", file);
  fd.append("name", guestInput.value || "Invitado");

  try {
    await fetch(`${API}/events/qr/${selectedQR}/audio`, {
      method: "POST",
      body: fd
    });

    guestInput.value = "";
    fileInput.value = ""; // reset

    loadEvent();

  } catch (err) {
    console.error("Error subiendo archivo:", err);
    alert("Error al subir audio");
  }
});
