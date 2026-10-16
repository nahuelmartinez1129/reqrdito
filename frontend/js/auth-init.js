
const GOOGLE_CLIENT_ID = "892308582344-6ms0bnobi61nk5vabum1bf94her4p3gu.apps.googleusercontent.com";

let googleReady = false;

/* =========================
   TOKEN
========================= */
function setToken(token) {
  localStorage.setItem("authToken", token);
  localStorage.setItem("loginTime", Date.now()); 
}

function getToken() {
  return localStorage.getItem("authToken");
}

function clearToken() {
  localStorage.removeItem("authToken");
}

function isLogged() {
  return !!getToken();
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

let sessionInterval = null;

function startSessionWatcher() {
  if (sessionInterval) {
    clearInterval(sessionInterval);
  }

  checkSession();

  sessionInterval = setInterval(() => {
    checkSession();
  }, 1000);
}

function checkSession() {

  const token = getToken();
  
  if (!token) return;

  const payload = parseJwt(token);
  

  if (!payload || !payload.exp) {
    clearToken();
    location.reload();
    return;
  }

  const ahora = Math.floor(Date.now() / 1000);
  
  if (ahora >= payload.exp) {
    
    clearToken();
    showSessionModal();
  }
}

function showSessionModal() {
  const modal = document.getElementById("sessionModal");
  const btn = document.getElementById("sessionBtn");

  if (!modal) return;

  modal.classList.add("active");

  btn.onclick = () => {
    window.location.href = "index.html";
  };
}
/* =========================
   GOOGLE INIT
========================= */
function waitForGoogle(cb) {
  if (window.google && google.accounts && google.accounts.id) {
    cb();
  } else {
    setTimeout(() => waitForGoogle(cb), 150);
  }
}

function initGoogle() {
  if (googleReady) return;

  waitForGoogle(() => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleLogin
    });
    googleReady = true;
  });
}

function renderGoogleButton(container) {
  if (!container) return;

  initGoogle();

  waitForGoogle(() => {
    container.innerHTML = "";
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      width: 240
    });
  });
}

/* =========================
   LOGIN REAL
========================= */
function handleGoogleLogin(response) {
  if (!response.credential) return;

  fetch("https://api.reqrdito.com/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      credential: response.credential
    })
  })
  .then(res => res.json())
  .then(data => {

    if (!data.token) {
  alert("Error al iniciar sesión");
  return;
}

setToken(data.token);

// 🔥 reiniciar control de sesión
startSessionWatcher();


    document.dispatchEvent(new Event("loginSuccess"));

    updateHeaderUI();

    // 🔥 Si estamos en mis-recuerdos
    if (window.location.pathname.includes("mis-recuerdos")) {
      document.dispatchEvent(new Event("recargarRecuerdos"));
    }
  })
  .catch(err => {
    console.error("Error login:", err);
  });
}

/* =========================
   HEADER
========================= */
function updateHeaderUI(containerId = "googleLogin") {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!isLogged()) {
    renderGoogleButton(container);
    return;
  }

  const payload = parseJwt(getToken());
  const nombre = payload?.name ? payload.name.split(" ")[0] : "Usuario";

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;color:white;font-weight:600;">
      Hola, ${nombre}
      <button id="logoutBtn" style="
        background:#EBAF2B;
        border:none;
        border-radius:20px;
        padding:6px 12px;
        cursor:pointer;
      ">
        Cerrar sesión
      </button>
    </div>
  `;

  document.getElementById("logoutBtn").onclick = () => {
    clearToken();

    // 🔥 Si estamos en mis recuerdos → volver al index
    if (window.location.pathname.includes("mis-recuerdos")) {
      window.location.href = "index.html";
    } else {
      location.reload();
    }
  };
}

function initHeader(containerId = "googleLogin") {
  updateHeaderUI(containerId);
}

/* =========================
   MODAL
========================= */
function initLoginModal(modalId, containerId) {
  const modal = document.getElementById(modalId);
  const container = document.getElementById(containerId);

  if (!modal || !container) return;

  renderGoogleButton(container);

  document.addEventListener("loginSuccess", () => {
    modal.classList.remove("is-active");
  });
}

window.auth = {
  isLogged,
  getToken,
  initHeader,
  initLoginModal,
  updateHeaderUI
};

checkSession();
document.addEventListener("DOMContentLoaded", () => {
  startSessionWatcher();
});