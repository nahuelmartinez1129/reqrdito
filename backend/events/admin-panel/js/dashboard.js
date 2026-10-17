/* =========================
   CREAR EVENTO
========================= */
async function createNewEvent() {
  const name = prompt("Nombre del evento:");
  if (!name) return;

  const email = prompt("Email del cliente:");
  if (!email) return;

  try {
    const res = await fetch("/events/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        emailCliente: email
      })
    });

    if (!res.ok) {
      alert("Error creando evento");
      return;
    }

    const event = await res.json();

    // 🔥 REDIRIGE DIRECTO AL EVENTO
    window.location.href = `event.html?id=${event._id}`;

  } catch (err) {
    console.error(err);
    alert("Error backend");
  }
}

/* =========================
   CARGAR EVENTOS
========================= */
async function loadEvents() {
  try {
    const res = await fetch("/events/list");
    const events = await res.json();

    const container = document.getElementById("events");
    container.innerHTML = "";

    if (events.length === 0) {
      container.innerHTML = "<p>No hay eventos todavía</p>";
      return;
    }

    events.forEach(e => {
      container.innerHTML += `
        <div class="card">
          <h3>${e.name}</h3>
          <button onclick="openEvent('${e._id}')">Entrar</button>
        </div>
      `;
    });

  } catch (err) {
    console.error(err);
  }
}

/* =========================
   ABRIR EVENTO
========================= */
function openEvent(id) {
  location.href = `event.html?id=${id}`;
}

/* =========================
   INIT
========================= */
loadEvents();
