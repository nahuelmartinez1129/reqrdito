document.addEventListener("DOMContentLoaded", () => {
  const googleLoginDiv = document.getElementById("googleLogin");
  const btnMisRecuerdos = document.getElementById("btnMisRecuerdos");
  const rqLoginModal = document.getElementById("rqLoginModal");
  const rqGoogleLogin = document.getElementById("rqGoogleLogin");
  const rqCloseModal = document.getElementById("rqCloseModal");

  const token = checkSession();

  if (token) {
    // Usuario ya logueado → mostrar en header
    googleLoginDiv.innerHTML = `
      <div class="user-session">
        <span>👋 Hola, ${window.currentUser.name || "Usuario"}</span>
        <button id="btnLogout" class="btn-link">Cerrar sesión</button>
      </div>
    `;

    document.getElementById("btnLogout").onclick = () => {
      localStorage.removeItem("authToken");
      googleLoginDiv.innerHTML = "";
      initGoogleLogin(googleLoginDiv, null);
    };

  } else {
    // Siempre mostrar botón de Google en index
    initGoogleLogin(googleLoginDiv, null);
  }

  // ===============================
  // Botón Mis recuerdos
  // ===============================
  btnMisRecuerdos.addEventListener("click", () => {
    const token = checkSession();
    if (!token) {
      // abrir modal
      rqLoginModal.classList.add("is-active");
      initGoogleLogin(rqGoogleLogin, "mis-recuerdos.html"); // redirige luego de login
      return;
    }
    window.location.href = "mis-recuerdos.html";
  });

  // ===============================
  // Cerrar modal
  // ===============================
  rqCloseModal.onclick = () => {
    rqLoginModal.classList.remove("is-active");
  };
  rqLoginModal.addEventListener("click", (e) => {
    if (e.target === rqLoginModal) rqLoginModal.classList.remove("is-active");
  });
});
