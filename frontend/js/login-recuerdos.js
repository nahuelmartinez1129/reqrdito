document.addEventListener("DOMContentLoaded", () => {

  // ===============================
  // ELEMENTOS
  // ===============================
  const btnMisRecuerdos = document.getElementById("btnMisRecuerdos");
  const googleLoginDiv = document.getElementById("googleLogin");

  // MODAL LOGIN
  const rqLoginModal = document.getElementById("rqLoginModal");
  const rqCloseModal = document.getElementById("rqCloseModal");
  const rqGoogleLogin = document.getElementById("rqGoogleLogin");

  let googleRendered = false; // 👈 clave

  // ===============================
  // UTILIDAD: DECODIFICAR JWT
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

  // ===============================
  // INIT HEADER
  // ===============================
  const token = localStorage.getItem("authToken");

  if (token) {
    const user = parseJwt(token);

    googleLoginDiv.innerHTML = `
      <div class="user-session">
        <span>👋 Hola, ${user?.name || "Usuario"}</span>
        <button id="btnLogout" class="btn-link">Cerrar sesión</button>
      </div>
    `;

    document.getElementById("btnLogout").onclick = () => {
      localStorage.removeItem("authToken");
      location.reload();
    };

  } else {
    google.accounts.id.initialize({
      client_id: "892308582344-6ms0bnobi61nk5vabum1bf94her4p3gu.apps.googleusercontent.com",
      callback: handleCredentialResponse,
    });

    // botón del header (opcional, podés dejarlo o no)
    google.accounts.id.renderButton(googleLoginDiv, {
      theme: "outline",
      size: "medium",
    });
  }

  // ===============================
  // BOTÓN MIS RECUERDOS
  // ===============================
  btnMisRecuerdos.addEventListener("click", () => {
    const token = localStorage.getItem("authToken");

    if (!token) {
      abrirModalLogin();
      return;
    }

    window.location.href = "mis-recuerdos.html";
  });

  // ===============================
  // ABRIR MODAL + GOOGLE
  // ===============================
  function abrirModalLogin() {
    rqLoginModal.classList.add("is-active");

    if (!googleRendered) {
      google.accounts.id.renderButton(
        rqGoogleLogin,
        { theme: "outline", size: "large" }
      );
      googleRendered = true;
    }
  }

  // ===============================
  // CERRAR MODAL
  // ===============================
  rqCloseModal.onclick = () => {
    rqLoginModal.classList.remove("is-active");
  };

  rqLoginModal.addEventListener("click", (e) => {
    if (e.target === rqLoginModal) {
      rqLoginModal.classList.remove("is-active");
    }
  });

});

// ===============================
// LOGIN GOOGLE → BACKEND → JWT
// ===============================
async function handleCredentialResponse(response) {
  try {
    const res = await fetch("https://api.reqrdito.com/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });

    const data = await res.json();

    if (!data.authToken) {
      throw new Error("No vino authToken");
    }

    localStorage.setItem("authToken", data.authToken);

    // cerrar modal
    const modal = document.getElementById("rqLoginModal");
    if (modal) modal.classList.remove("is-active");

    location.reload();

  } catch (err) {
    console.error("❌ ERROR LOGIN:", err);
    alert("Error iniciando sesión con Google");
  }
}
