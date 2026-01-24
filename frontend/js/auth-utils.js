// ===============================
// AUTH UTILS - GLOBAL (FINAL)
// ===============================

function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now;
}

function checkSession() {
  const token = localStorage.getItem("authToken");

  if (!token || isTokenExpired(token)) {
    logout("Tu sesión expiró. Volvé a iniciar sesión.");
    return null;
  }

  return token;
}

function logout(message) {
  // 🔐 borrar token
  localStorage.removeItem("authToken");

  // 🔍 buscar modal
  const modal = document.getElementById("sessionModal");
  const btn = document.getElementById("sessionBtn");

  // 🟡 fallback (solo si el modal no existe)
  if (!modal || !btn) {
    console.warn("Modal de sesión no encontrado, usando fallback");
    window.location.href = "index.html";
    return;
  }

  // 🟢 mostrar modal
  modal.classList.remove("oculto");

  // bloquear scroll
  document.body.style.overflow = "hidden";

  // botón volver
  btn.onclick = () => {
    window.location.href = "index.html";
  };
}
