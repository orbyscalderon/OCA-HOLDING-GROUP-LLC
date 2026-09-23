/**
 * OCA Holding Group LLC — main.js
 * ---------------------------------------------------------------
 * Responsable de:
 *  1. Motor de internacionalización (i18n) ES/EN basado en atributos
 *     data-i18n / data-i18n-placeholder, leyendo de window.OCA_TRANSLATIONS.
 *  2. Menú móvil y header sticky con sombra al hacer scroll.
 *  3. Animaciones scroll-reveal (IntersectionObserver).
 *  4. Render dinámico de Portafolio y Noticias desde window.OCA_DATA
 *     (pensado para ser reemplazado por fetch() a una API/CMS real).
 *  5. Validación y envío (simulado) del formulario de contacto.
 *
 * Este archivo es vanilla JS, sin dependencias, para poder integrarse
 * fácilmente en cualquier CMS (WordPress, Webflow custom code, etc.)
 * o servir de referencia al migrar a un framework como Next.js.
 */

(function () {
  "use strict";

  const LANG_STORAGE_KEY = "oca_lang";
  const DEFAULT_LANG = "es";

  /* -------------------------------------------------------------
   * 1. I18N ENGINE
   * ----------------------------------------------------------- */

  function getCurrentLang() {
    return localStorage.getItem(LANG_STORAGE_KEY) || DEFAULT_LANG;
  }

  function setCurrentLang(lang) {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }

  // Resuelve una ruta tipo "home.heroTitle" dentro de un objeto anidado
  function resolvePath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
  }

  function applyTranslations(lang) {
    const dict = window.OCA_TRANSLATIONS && window.OCA_TRANSLATIONS[lang];
    if (!dict) return;

    document.documentElement.setAttribute("lang", lang);

    // Texto simple
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const value = resolvePath(dict, key);
      if (value !== null) el.textContent = value;
    });

    // Placeholders de inputs/textareas
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const value = resolvePath(dict, key);
      if (value !== null) el.setAttribute("placeholder", value);
    });

    // Botón / indicador de cambio de idioma (muestra el idioma AL QUE SE CAMBIARÁ)
    document.querySelectorAll("[data-lang-toggle-label]").forEach((el) => {
      el.textContent = resolvePath(dict, "nav.langSwitch");
    });

    // Marca visualmente el enlace de navegación activo según data-nav-key
    document.querySelectorAll("[data-nav-key]").forEach((el) => {
      const isCurrent = el.getAttribute("data-nav-key") === document.body.getAttribute("data-page");
      el.classList.toggle("is-active", isCurrent);
    });

    document.dispatchEvent(new CustomEvent("oca:translated", { detail: { lang } }));
  }

  function initLanguageToggle() {
    const lang = getCurrentLang();
    applyTranslations(lang);

    document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = getCurrentLang() === "es" ? "en" : "es";
        setCurrentLang(next);
        applyTranslations(next);
        // Vuelve a renderizar contenido dinámico (portafolio/noticias) en el nuevo idioma
        renderPortfolio(getCurrentLang());
        renderNews(getCurrentLang());
      });
    });
  }

  /* -------------------------------------------------------------
   * 2. NAVEGACIÓN: menú móvil + header sticky
   * ----------------------------------------------------------- */

  function initMobileMenu() {
    const toggleBtn = document.getElementById("menu-toggle");
    const menu = document.getElementById("mobile-menu");
    if (!toggleBtn || !menu) return;

    toggleBtn.addEventListener("click", () => {
      const isOpen = menu.classList.toggle("is-open");
      toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      const iconOpen = toggleBtn.querySelector("[data-icon-open]");
      const iconClose = toggleBtn.querySelector("[data-icon-close]");
      if (iconOpen && iconClose) {
        iconOpen.classList.toggle("hidden", isOpen);
        iconClose.classList.toggle("hidden", !isOpen);
      }
    });

    // Cierra el menú al navegar (mejora UX en móvil)
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => menu.classList.remove("is-open"));
    });
  }

  function initStickyHeader() {
    const header = document.getElementById("site-header");
    if (!header) return;
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* -------------------------------------------------------------
   * 3. SCROLL REVEAL
   * ----------------------------------------------------------- */

  function initScrollReveal() {
    const elements = document.querySelectorAll("[data-reveal]");
    if (!elements.length) return;

    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    elements.forEach((el) => observer.observe(el));
  }

  /* -------------------------------------------------------------
   * 4. RENDER DINÁMICO: PORTAFOLIO
   * ----------------------------------------------------------- */

  let activeSector = "all";

  function renderPortfolio(lang) {
    const grid = document.getElementById("portfolio-grid");
    if (!grid || !window.OCA_DATA) return;

    const dict = window.OCA_TRANSLATIONS[lang].portfolio;
    const companies = window.OCA_DATA.companies.filter(
      (c) => activeSector === "all" || c.sector === activeSector
    );

    grid.innerHTML = companies
      .map((company) => {
        const content = company[lang];
        return `
        <article class="oca-card group flex flex-col rounded-xl border border-slate-200 bg-white p-6 sm:p-7" data-reveal>
          <div class="flex items-center gap-4 mb-4">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--oca-navy)] font-serif-display text-lg font-semibold text-[var(--oca-gold-light)]">
              ${company.logoInitial}
            </div>
            <div>
              <span class="inline-block rounded-full bg-[var(--oca-paper)] px-3 py-1 text-xs font-medium uppercase tracking-wide text-[var(--oca-navy)]">
                ${dict["sector_" + (company.sector === "realestate" ? "realestate" : company.sector)]}
              </span>
            </div>
          </div>
          <h3 class="font-serif-display text-xl font-semibold text-[var(--oca-navy)] mb-1">${content.name}</h3>
          <p class="text-sm font-medium text-[var(--oca-gold)] mb-3">${content.tagline}</p>
          <p class="text-sm text-slate-600 leading-relaxed mb-6 flex-1">${content.description}</p>
          <button type="button" class="oca-view-details mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[var(--oca-navy)] hover:text-[var(--oca-gold)] transition-colors" data-company-id="${company.id}">
            ${dict.viewDetails}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 9H3a1 1 0 110-2h9.586l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
          </button>
        </article>`;
      })
      .join("");

    initScrollReveal();
    grid.querySelectorAll(".oca-view-details").forEach((btn) => {
      btn.addEventListener("click", () => openCompanyModal(parseInt(btn.getAttribute("data-company-id"), 10)));
    });
  }

  function openCompanyModal(companyId) {
    const modal = document.getElementById("company-modal");
    if (!modal || !window.OCA_DATA) return;
    const lang = getCurrentLang();
    const dict = window.OCA_TRANSLATIONS[lang].portfolio;
    const company = window.OCA_DATA.companies.find((c) => c.id === companyId);
    if (!company) return;
    const content = company[lang];

    modal.querySelector("[data-modal-name]").textContent = content.name;
    modal.querySelector("[data-modal-tagline]").textContent = content.tagline;
    modal.querySelector("[data-modal-description]").textContent = content.description;
    modal.querySelector("[data-modal-sector]").textContent = dict["sector_" + company.sector];
    modal.querySelector("[data-modal-status]").textContent = dict.statusActive;
    modal.querySelector("[data-modal-joined]").textContent = dict.inceptionLabel + " " + company.joinedYear;
    modal.querySelector("[data-modal-industry-label]").textContent = dict.cardIndustryLabel;
    modal.querySelector("[data-modal-status-label]").textContent = dict.cardStatusLabel;
    const link = modal.querySelector("[data-modal-link]");
    link.href = company.website;
    link.textContent = dict.visitSite;

    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  }

  function initCompanyModal() {
    const modal = document.getElementById("company-modal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target.matches("[data-modal-close]") || e.target === modal) {
        modal.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
      }
    });
  }

  function initSectorFilters() {
    const buttons = document.querySelectorAll("[data-sector-filter]");
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSector = btn.getAttribute("data-sector-filter");
        buttons.forEach((b) => b.classList.remove("bg-[var(--oca-navy)]", "text-white"));
        buttons.forEach((b) => b.classList.add("bg-white", "text-[var(--oca-navy)]"));
        btn.classList.remove("bg-white", "text-[var(--oca-navy)]");
        btn.classList.add("bg-[var(--oca-navy)]", "text-white");
        renderPortfolio(getCurrentLang());
      });
    });
  }

  /* -------------------------------------------------------------
   * 5. RENDER DINÁMICO: NOTICIAS
   * ----------------------------------------------------------- */

  let activeCategory = "all";

  function formatDate(dateStr, lang) {
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      return dateStr;
    }
  }

  function renderNews(lang) {
    const list = document.getElementById("news-list");
    if (!list || !window.OCA_DATA) return;

    const dict = window.OCA_TRANSLATIONS[lang].news;
    const items = window.OCA_DATA.news
      .filter((n) => activeCategory === "all" || n.category === activeCategory)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    list.innerHTML = items
      .map((item) => {
        const content = item[lang];
        return `
        <article class="oca-card flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden" data-reveal>
          <div class="p-6 sm:p-7 flex flex-col flex-1">
            <div class="flex items-center justify-between mb-4">
              <span class="inline-block rounded-full bg-[var(--oca-paper)] px-3 py-1 text-xs font-medium uppercase tracking-wide text-[var(--oca-navy)]">
                ${dict["cat_" + item.category]}
              </span>
              <time class="text-xs text-slate-500">${formatDate(item.date, lang)}</time>
            </div>
            <h3 class="font-serif-display text-lg font-semibold text-[var(--oca-navy)] mb-2">${content.title}</h3>
            <p class="text-sm text-slate-600 leading-relaxed mb-5 flex-1">${content.excerpt}</p>
            <button type="button" class="oca-read-more mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[var(--oca-navy)] hover:text-[var(--oca-gold)] transition-colors" data-news-id="${item.id}">
              ${dict.readMore}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 9H3a1 1 0 110-2h9.586l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
            </button>
          </div>
        </article>`;
      })
      .join("");

    initScrollReveal();
    list.querySelectorAll(".oca-read-more").forEach((btn) => {
      btn.addEventListener("click", () => openNewsModal(parseInt(btn.getAttribute("data-news-id"), 10)));
    });
  }

  function openNewsModal(newsId) {
    const modal = document.getElementById("news-modal");
    if (!modal || !window.OCA_DATA) return;
    const lang = getCurrentLang();
    const dict = window.OCA_TRANSLATIONS[lang].news;
    const item = window.OCA_DATA.news.find((n) => n.id === newsId);
    if (!item) return;
    const content = item[lang];

    modal.querySelector("[data-modal-news-title]").textContent = content.title;
    modal.querySelector("[data-modal-news-body]").textContent = content.body;
    modal.querySelector("[data-modal-news-date]").textContent = formatDate(item.date, lang);
    modal.querySelector("[data-modal-news-category]").textContent = dict["cat_" + item.category];

    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  }

  function initNewsModal() {
    const modal = document.getElementById("news-modal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target.matches("[data-modal-close]") || e.target === modal) {
        modal.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
      }
    });
  }

  function initCategoryFilters() {
    const buttons = document.querySelectorAll("[data-category-filter]");
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategory = btn.getAttribute("data-category-filter");
        buttons.forEach((b) => b.classList.remove("bg-[var(--oca-navy)]", "text-white"));
        buttons.forEach((b) => b.classList.add("bg-white", "text-[var(--oca-navy)]"));
        btn.classList.remove("bg-white", "text-[var(--oca-navy)]");
        btn.classList.add("bg-[var(--oca-navy)]", "text-white");
        renderNews(getCurrentLang());
      });
    });
  }

  /* -------------------------------------------------------------
   * 6. FORMULARIO DE CONTACTO
   * ----------------------------------------------------------- */

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function initContactForm() {
    const form = document.getElementById("contact-form");
    if (!form) return;

    const successBox = document.getElementById("form-success");
    const submitBtn = form.querySelector("[data-submit-button]");

    function setFieldError(field, hasError) {
      const wrapper = field.closest("[data-field]");
      if (wrapper) wrapper.classList.toggle("field-invalid", hasError);
    }

    function validateField(field) {
      const value = field.value.trim();
      if (field.hasAttribute("required") && !value) {
        setFieldError(field, true);
        return false;
      }
      if (field.type === "email" && value && !isValidEmail(value)) {
        setFieldError(field, true);
        return false;
      }
      setFieldError(field, false);
      return true;
    }

    form.querySelectorAll("input, textarea, select").forEach((field) => {
      field.addEventListener("blur", () => validateField(field));
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const fields = Array.from(form.querySelectorAll("input, textarea, select"));
      const isValid = fields.map(validateField).every(Boolean);
      if (!isValid) return;

      const payload = {
        fullName: form.fullName.value.trim(),
        email: form.email.value.trim(),
        company: form.company ? form.company.value.trim() : "",
        phone: form.phone ? form.phone.value.trim() : "",
        department: form.department.value,
        message: form.message.value.trim()
      };

      submitBtn.disabled = true;
      submitBtn.classList.add("opacity-70", "cursor-not-allowed");
      const originalContent = submitBtn.innerHTML;
      const lang = getCurrentLang();
      submitBtn.innerHTML =
        '<span class="oca-spinner inline-block align-middle mr-2"></span>' +
        window.OCA_TRANSLATIONS[lang].contact.submitting;

      try {
        // INTEGRACIÓN BACKEND:
        // Reemplazar este bloque por una llamada real a la API, por ejemplo:
        // const response = await fetch("/api/contact", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify(payload)
        // });
        // if (!response.ok) throw new Error("Request failed");
        // Ver /backend/contact-api-node.js o /backend/contact_api_fastapi.py
        await new Promise((resolve) => setTimeout(resolve, 900));

        form.reset();
        form.classList.add("hidden");
        if (successBox) successBox.classList.remove("hidden");
      } catch (err) {
        alert(window.OCA_TRANSLATIONS[lang].contact.errorGeneric);
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove("opacity-70", "cursor-not-allowed");
        submitBtn.innerHTML = originalContent;
      }
    });
  }

  /* -------------------------------------------------------------
   * 7. FOOTER: AÑO ACTUAL
   * ----------------------------------------------------------- */

  function initFooterYear() {
    document.querySelectorAll("[data-current-year]").forEach((el) => {
      el.textContent = new Date().getFullYear();
    });
  }

  /* -------------------------------------------------------------
   * BOOTSTRAP
   * ----------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    initLanguageToggle();
    initMobileMenu();
    initStickyHeader();
    initScrollReveal();
    initFooterYear();

    renderPortfolio(getCurrentLang());
    initSectorFilters();
    initCompanyModal();

    renderNews(getCurrentLang());
    initCategoryFilters();
    initNewsModal();

    initContactForm();
  });
})();
