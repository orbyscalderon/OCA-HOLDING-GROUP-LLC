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
      window.location.href = "dashboard.html";
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
      // Supabase (comportamiento por defecto), no hay sesión todavía.
      if (data.session) {
        window.location.href = "dashboard.html";
      } else {
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

  async function redirectIfAlreadySignedIn(supabaseClient) {
    if (!supabaseClient) return;
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) window.location.href = "dashboard.html";
  }

  document.addEventListener("DOMContentLoaded", () => {
    initConfigWarning();
    initTabs();
    const supabaseClient = getSupabaseClient();
    initSignIn(supabaseClient);
    initSignUp(supabaseClient);
    initForgotPassword(supabaseClient);
    redirectIfAlreadySignedIn(supabaseClient);
  });
})();
