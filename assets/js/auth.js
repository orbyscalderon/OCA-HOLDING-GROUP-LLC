/**
 * OCA Holding Group LLC — Autenticación del Portal de Clientes (login.html)
 * ---------------------------------------------------------------
 * Usa Supabase Auth directamente desde el navegador (supabase-js). No hay
 * contraseñas ni tokens manejados por nuestro propio backend: Supabase se
 * encarga de todo el ciclo de vida de la sesión, y Row Level Security
 * (ver backend/schema.sql) garantiza que cada cliente solo pueda leer sus
 * propios datos una vez autenticado.
 */
(function () {
  "use strict";

  function getSupabaseClient() {
    if (!window.OCA_SUPABASE_CONFIGURED || !window.supabase) return null;
    if (!window.__ocaSupabaseClient) {
      window.__ocaSupabaseClient = window.supabase.createClient(window.OCA_SUPABASE_URL, window.OCA_SUPABASE_ANON_KEY);
    }
    return window.__ocaSupabaseClient;
  }

  function getLang() {
    try {
      return localStorage.getItem("oca_lang") || "es";
    } catch (e) {
      return "es";
    }
  }

  function t(key) {
    const dict = window.OCA_TRANSLATIONS && window.OCA_TRANSLATIONS[getLang()];
    return key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : null), dict) || key;
  }

  function showMessage(box, text, type) {
    if (!box) return;
    box.textContent = text;
    box.classList.remove("hidden", "bg-green-50", "text-green-700", "bg-red-50", "text-red-700", "bg-blue-50", "text-blue-700");
    if (type === "success") box.classList.add("bg-green-50", "text-green-700");
    else if (type === "error") box.classList.add("bg-red-50", "text-red-700");
    else box.classList.add("bg-blue-50", "text-blue-700");
  }

  function initTabs() {
    const tabButtons = document.querySelectorAll("[data-tab]");
    const signinForm = document.getElementById("signin-form");
    const signupForm = document.getElementById("signup-form");
    if (!tabButtons.length || !signinForm || !signupForm) return;

    function activate(tab) {
      tabButtons.forEach((btn) => {
        const isActive = btn.getAttribute("data-tab") === tab;
        btn.classList.toggle("bg-navy", isActive);
        btn.classList.toggle("text-white", isActive);
        btn.classList.toggle("text-graphite", !isActive);
      });
      signinForm.classList.toggle("hidden", tab !== "signin");
      signupForm.classList.toggle("hidden", tab !== "signup");
      document.getElementById("form-message").classList.add("hidden");
    }

    tabButtons.forEach((btn) => btn.addEventListener("click", () => activate(btn.getAttribute("data-tab"))));
    activate("signin");
  }

  function setSubmitting(form, isSubmitting) {
    const btn = form.querySelector("[data-submit-button]");
    if (!btn) return;
    btn.disabled = isSubmitting;
    btn.classList.toggle("opacity-70", isSubmitting);
    btn.classList.toggle("cursor-not-allowed", isSubmitting);
    if (isSubmitting) {
      btn.dataset.originalText = btn.textContent;
      btn.textContent = t("login.submitting");
    } else if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
    }
  }

  function initConfigWarning() {
    const warning = document.getElementById("config-warning");
    if (!warning) return;
    if (!window.OCA_SUPABASE_CONFIGURED) warning.classList.remove("hidden");
  }

  function initSignIn(supabaseClient) {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const messageBox = document.getElementById("form-message");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!supabaseClient) return showMessage(messageBox, t("login.errorConfigMissing"), "error");

      setSubmitting(form, true);
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: form.email.value.trim(),
        password: form.password.value
      });

      setSubmitting(form, false);
      if (error) {
        showMessage(messageBox, t("login.errorInvalidCredentials"), "error");
        return;
      }
      // La redirección (admin.html vs dashboard.html según is_staff) la
      // maneja initAuthStateListener al recibir el evento SIGNED_IN.
    });
  }

  function initSignUp(supabaseClient) {
    const form = document.getElementById("signup-form");
    if (!form) return;
    const messageBox = document.getElementById("form-message");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!supabaseClient) return showMessage(messageBox, t("login.errorConfigMissing"), "error");

      setSubmitting(form, true);
      const { data, error } = await supabaseClient.auth.signUp({
        email: form.email.value.trim(),
        password: form.password.value,
        options: {
          data: {
            full_name: form.fullName.value.trim(),
            company_name: form.company.value.trim()
          }
        }
      });
      setSubmitting(form, false);

      if (error) {
        showMessage(messageBox, error.message || t("login.errorGeneric"), "error");
        return;
      }

      // Si la confirmación por correo está activada en el proyecto de
      // Supabase (comportamiento por defecto), no hay sesión todavía y no
      // pasa nada más aquí: initAuthStateListener redirige solo si sí la hay.
      if (!data.session) {
        showMessage(messageBox, t("login.signUpSuccessCheckEmail"), "success");
        form.reset();
      }
    });
  }

  function initForgotPassword(supabaseClient) {
    const link = document.getElementById("forgot-password-link");
    if (!link) return;
    const messageBox = document.getElementById("form-message");

    link.addEventListener("click", async () => {
      if (!supabaseClient) return showMessage(messageBox, t("login.errorConfigMissing"), "error");
      const email = document.getElementById("signin-email").value.trim();
      if (!email) return showMessage(messageBox, t("contact.errorEmail"), "error");

      await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/login.html"
      });
      showMessage(messageBox, t("login.forgotPasswordSent"), "success");
    });
  }

  // Muestra el formulario de "nueva contraseña" y oculta el resto — usado
  // cuando Supabase confirma que el visitante llegó desde un enlace de
  // recuperación válido (evento PASSWORD_RECOVERY, ver initAuthStateListener).
  function showResetPasswordForm() {
    const tabs = document.querySelector(".flex.rounded-full.bg-paper");
    const signinForm = document.getElementById("signin-form");
    const signupForm = document.getElementById("signup-form");
    const resetForm = document.getElementById("reset-password-form");
    if (tabs) tabs.classList.add("hidden");
    if (signinForm) signinForm.classList.add("hidden");
    if (signupForm) signupForm.classList.add("hidden");
    if (resetForm) resetForm.classList.remove("hidden");
  }

  function initResetPasswordForm(supabaseClient) {
    const form = document.getElementById("reset-password-form");
    if (!form) return;
    const messageBox = document.getElementById("form-message");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setSubmitting(form, true);
      const { error } = await supabaseClient.auth.updateUser({ password: form.newPassword.value });
      setSubmitting(form, false);

      if (error) {
        showMessage(messageBox, error.message || t("login.errorGeneric"), "error");
        return;
      }
      showMessage(messageBox, t("login.resetPasswordSuccess"), "success");
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1500);
    });
  }

  // "Continuar con Google": flujo client-side de Google Identity Services
  // (mismo patrón que usan otros proyectos OCA) — el navegador obtiene el ID
  // token directo de Google y se lo pasa a Supabase vía signInWithIdToken.
  // A diferencia de supabaseClient.auth.signInWithOAuth(), esto NO redirige
  // a ningún dominio de Supabase: no hay "redirect URI" que configurar en
  // Google Cloud Console, solo "Authorized JavaScript origins" con el
  // dominio real del sitio. El script de Google carga con async/defer, así
  // que puede no estar listo todavía cuando corre DOMContentLoaded — se
  // reintenta unas cuantas veces antes de rendirse en silencio.
  function initGoogleSignIn(supabaseClient, attemptsLeft) {
    if (attemptsLeft === undefined) attemptsLeft = 20;
    if (!supabaseClient || !window.OCA_GOOGLE_CONFIGURED) return;

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      if (attemptsLeft <= 0) return; // Google Identity Services no cargó — se deja el botón oculto
      setTimeout(() => initGoogleSignIn(supabaseClient, attemptsLeft - 1), 250);
      return;
    }

    const wrap = document.getElementById("google-signin-wrap");
    const buttonEl = document.getElementById("google-signin-button");
    if (!wrap || !buttonEl) return;

    google.accounts.id.initialize({
      client_id: window.OCA_GOOGLE_CLIENT_ID,
      callback: async (response) => {
        const messageBox = document.getElementById("form-message");
        const { error } = await supabaseClient.auth.signInWithIdToken({
          provider: "google",
          token: response.credential
        });
        if (error) {
          showMessage(messageBox, error.message || t("login.errorGeneric"), "error");
          return;
        }
        // La redirección (admin.html vs dashboard.html) la maneja
        // initAuthStateListener al recibir el evento SIGNED_IN.
      }
    });

    google.accounts.id.renderButton(buttonEl, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      width: 320,
      text: "continue_with",
      locale: getLang()
    });

    wrap.classList.remove("hidden");
  }

  async function redirectAfterAuth(supabaseClient, session) {
    const { data: profile } = await supabaseClient.from("profiles").select("is_staff").eq("id", session.user.id).single();
    window.location.href = profile && profile.is_staff ? "admin.html" : "dashboard.html";
  }

  // Escucha los cambios de sesión en vez de solo leerla una vez al cargar:
  // así podemos distinguir "ya tiene sesión, mándalo al panel" de "acaba de
  // llegar de un enlace de recuperación, muéstrale el formulario de nueva
  // contraseña" — ambos casos crean una sesión, pero requieren manejo distinto.
  function initAuthStateListener(supabaseClient) {
    if (!supabaseClient) return;
    // Supabase dispara INITIAL_SESSION (a veces antes que PASSWORD_RECOVERY)
    // apenas detecta una sesión en la URL — incluida la sesión temporal que
    // crea un link de recuperación. Sin este chequeo, esa sesión temporal
    // dispara el redirect normal (admin/dashboard) antes de que el usuario
    // llegue a ver el formulario de nueva contraseña.
    const isRecoveryFlow = window.location.hash.indexOf("type=recovery") !== -1;
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showResetPasswordForm();
        return;
      }
      if (isRecoveryFlow) return;
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        redirectAfterAuth(supabaseClient, session);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initConfigWarning();
    initTabs();
    const supabaseClient = getSupabaseClient();
    initSignIn(supabaseClient);
    initSignUp(supabaseClient);
    initForgotPassword(supabaseClient);
    initResetPasswordForm(supabaseClient);
    initAuthStateListener(supabaseClient);
    initGoogleSignIn(supabaseClient);
  });
})();
