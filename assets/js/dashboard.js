/**
 * OCA Holding Group LLC — Panel del Portal de Clientes (dashboard.html)
 * ---------------------------------------------------------------
 * Lee proyectos, bitácora de avances y facturas directamente de Supabase
 * (protegido por Row Level Security: cada cliente solo ve lo suyo). El
 * único momento en que se llama a NUESTRO backend es para generar el link
 * de pago de Stripe, porque crear una Checkout Session requiere la clave
 * secreta de Stripe, que nunca debe vivir en el navegador.
 */
(function () {
  "use strict";

  // Se fija una sola vez en DOMContentLoaded y lo usan payInvoice/payRetainer/
  // cancelRetainer para adjuntar el token de sesión a las llamadas al backend.
  let currentSupabaseClient = null;

  async function getAuthHeaders() {
    if (!currentSupabaseClient) return {};
    const { data } = await currentSupabaseClient.auth.getSession();
    return data && data.session ? { Authorization: "Bearer " + data.session.access_token } : {};
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

  function formatMoney(amountCents, currency) {
    try {
      return new Intl.NumberFormat(getLang() === "es" ? "es-US" : "en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase()
      }).format(amountCents / 100);
    } catch (e) {
      return "$" + (amountCents / 100).toFixed(2);
    }
  }

  function formatDate(dateStr) {
    try {
      return new Date(dateStr).toLocaleDateString(getLang() === "es" ? "es-ES" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      return dateStr;
    }
  }

  function getSupabaseClient() {
    if (!window.OCA_SUPABASE_CONFIGURED || !window.supabase) return null;
    if (!window.__ocaSupabaseClient) {
      window.__ocaSupabaseClient = window.supabase.createClient(window.OCA_SUPABASE_URL, window.OCA_SUPABASE_ANON_KEY);
    }
    return window.__ocaSupabaseClient;
  }

  function renderProjects(projects) {
    const list = document.getElementById("projects-list");
    const emptyMsg = document.getElementById("no-projects");
    if (!projects.length) {
      emptyMsg.classList.remove("hidden");
      return;
    }

    list.innerHTML = projects
      .map((project) => {
        const updates = (project.project_updates || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const timelineHtml = updates.length
          ? updates
              .map(
                (u) => `
            <div class="timeline-item">
              <p class="text-sm font-semibold text-navy">${escapeHtml(u.title)}</p>
              ${u.description ? `<p class="text-sm text-slate-600 mt-0.5">${escapeHtml(u.description)}</p>` : ""}
              <time class="text-xs text-slate-400 mt-1 block">${formatDate(u.created_at)}</time>
            </div>`
              )
              .join("")
          : `<p class="text-sm text-slate-400">${t("dashboard.timelineEmpty")}</p>`;

        return `
        <article class="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h3 class="font-serif text-lg font-semibold text-navy">${escapeHtml(project.title)}</h3>
            <span class="status-pill status-${project.status}">${t("dashboard.status" + toPascalCase(project.status))}</span>
          </div>
          <div class="pl-1">${timelineHtml}</div>
        </article>`;
      })
      .join("");
  }

  function toPascalCase(snake) {
    return snake.replace(/(^\w|_\w)/g, (m) => m.replace("_", "").toUpperCase());
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function renderInvoices(invoices) {
    const list = document.getElementById("invoices-list");
    const emptyMsg = document.getElementById("no-invoices");
    if (!invoices.length) {
      emptyMsg.classList.remove("hidden");
      return;
    }

    const statusStyles = {
      pending: "bg-amber-50 text-amber-800",
      paid: "bg-green-50 text-green-700",
      failed: "bg-red-50 text-red-700",
      refunded: "bg-slate-100 text-slate-600",
      canceled: "bg-slate-100 text-slate-600"
    };

    list.innerHTML = invoices
      .map((invoice) => {
        const statusLabel = t("dashboard.invoiceStatus" + toPascalCase(invoice.status));
        const canPay = invoice.status === "pending";
        return `
        <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <p class="text-sm font-semibold text-navy">${escapeHtml(invoice.description)}</p>
            <p class="text-xs text-slate-400 mt-1">${formatDate(invoice.created_at)}</p>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-serif text-lg font-semibold text-navy">${formatMoney(invoice.amount_cents, invoice.currency)}</span>
            <span class="status-pill ${statusStyles[invoice.status] || "bg-slate-100 text-slate-600"}">${statusLabel}</span>
            ${
              canPay
                ? `<button type="button" class="oca-pay-btn rounded-full bg-gold px-5 py-2 text-xs font-semibold text-navy hover:bg-gold-light transition-colors" data-invoice-id="${invoice.id}">${t(
                    "dashboard.payNow"
                  )}</button>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".oca-pay-btn").forEach((btn) => {
      btn.addEventListener("click", () => payInvoice(btn));
    });
  }

  async function payInvoice(btn) {
    const invoiceId = btn.getAttribute("data-invoice-id");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("dashboard.paying");

    try {
      const apiBase = window.OCA_API_BASE_URL || "";
      const response = await fetch(apiBase + "/api/create-checkout-session", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, await getAuthHeaders()),
        body: JSON.stringify({ invoiceId })
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error("checkout_session_failed");
      window.location.href = data.url;
    } catch (err) {
      console.error("payInvoice error:", err);
      btn.disabled = false;
      btn.textContent = originalText;
      alert(t("contact.errorGeneric"));
    }
  }

  function renderRetainers(retainers) {
    const list = document.getElementById("retainers-list");
    const emptyMsg = document.getElementById("no-retainers");
    if (!retainers.length) {
      emptyMsg.classList.remove("hidden");
      return;
    }

    const statusStyles = {
      pending: "bg-amber-50 text-amber-800",
      active: "bg-green-50 text-green-700",
      past_due: "bg-red-50 text-red-700",
      unpaid: "bg-red-50 text-red-700",
      canceled: "bg-slate-100 text-slate-600"
    };
    const intervalLabel = { month: t("dashboard.perMonth"), year: t("dashboard.perYear") };

    list.innerHTML = retainers
      .map((retainer) => {
        const statusLabel = t("dashboard.retainerStatus" + toPascalCase(retainer.status));
        const actionHtml =
          retainer.status === "pending"
            ? `<button type="button" class="oca-activate-retainer-btn rounded-full bg-gold px-5 py-2 text-xs font-semibold text-navy hover:bg-gold-light transition-colors" data-retainer-id="${retainer.id}">${t(
                "dashboard.activate"
              )}</button>`
            : retainer.status === "active"
              ? `<button type="button" class="oca-cancel-retainer-btn rounded-full border border-slate-300 px-5 py-2 text-xs font-semibold text-navy hover:border-navy transition-colors" data-retainer-id="${retainer.id}">${t(
                  "dashboard.cancel"
                )}</button>`
              : "";

        return `
        <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <p class="text-sm font-semibold text-navy">${escapeHtml(retainer.description)}</p>
            <p class="text-xs text-slate-400 mt-1">${formatDate(retainer.created_at)}</p>
          </div>
          <div class="flex items-center gap-4">
            <span class="font-serif text-lg font-semibold text-navy">${formatMoney(retainer.amount_cents, retainer.currency)}<span class="text-xs font-sans text-slate-400"> / ${intervalLabel[retainer.billing_interval] || retainer.billing_interval}</span></span>
            <span class="status-pill ${statusStyles[retainer.status] || "bg-slate-100 text-slate-600"}">${statusLabel}</span>
            ${actionHtml}
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".oca-activate-retainer-btn").forEach((btn) => btn.addEventListener("click", () => payRetainer(btn)));
    list.querySelectorAll(".oca-cancel-retainer-btn").forEach((btn) => btn.addEventListener("click", () => cancelRetainer(btn)));
  }

  function toPascalCase(snake) {
    return snake.replace(/(^\w|_\w)/g, (m) => m.replace("_", "").toUpperCase());
  }

  async function payRetainer(btn) {
    const retainerId = btn.getAttribute("data-retainer-id");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("dashboard.paying");

    try {
      const apiBase = window.OCA_API_BASE_URL || "";
      const response = await fetch(apiBase + "/api/create-subscription-checkout", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, await getAuthHeaders()),
        body: JSON.stringify({ retainerId })
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error("subscription_checkout_failed");
      window.location.href = data.url;
    } catch (err) {
      console.error("payRetainer error:", err);
      btn.disabled = false;
      btn.textContent = originalText;
      alert(t("contact.errorGeneric"));
    }
  }

  async function cancelRetainer(btn) {
    if (!window.confirm(t("dashboard.confirmCancelRetainer"))) return;
    const retainerId = btn.getAttribute("data-retainer-id");
    btn.disabled = true;
    btn.textContent = t("dashboard.canceling");

    try {
      const apiBase = window.OCA_API_BASE_URL || "";
      const response = await fetch(apiBase + "/api/cancel-subscription", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, await getAuthHeaders()),
        body: JSON.stringify({ retainerId })
      });
      if (!response.ok) throw new Error("cancel_failed");
      const { data: session } = await currentSupabaseClient.auth.getSession();
      await loadDashboard(currentSupabaseClient, session.session);
    } catch (err) {
      console.error("cancelRetainer error:", err);
      btn.disabled = false;
      alert(t("contact.errorGeneric"));
    }
  }

  function renderPaymentBanners() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const subscription = params.get("subscription");
    if (payment === "success" || subscription === "success") {
      const banner = document.getElementById("payment-success-banner");
      banner.textContent = t(subscription ? "dashboard.subscriptionSuccessBanner" : "dashboard.paymentSuccessBanner");
      banner.classList.remove("hidden");
    } else if (payment === "canceled" || subscription === "canceled") {
      const banner = document.getElementById("payment-canceled-banner");
      banner.textContent = t("dashboard.paymentCanceledBanner");
      banner.classList.remove("hidden");
    }
  }

  async function loadDashboard(supabaseClient, session) {
    const userId = session.user.id;

    const [
      { data: profile },
      { data: projects, error: projectsError },
      { data: invoices, error: invoicesError },
      { data: retainers, error: retainersError }
    ] = await Promise.all([
      supabaseClient.from("profiles").select("full_name").eq("id", userId).single(),
      supabaseClient
        .from("projects")
        .select("id, title, status, created_at, project_updates(id, title, description, created_at)")
        .eq("client_id", userId)
        .order("created_at", { ascending: false }),
      supabaseClient.from("invoices").select("id, description, amount_cents, currency, status, created_at").eq("client_id", userId).order("created_at", { ascending: false }),
      supabaseClient
        .from("retainers")
        .select("id, description, amount_cents, currency, billing_interval, status, created_at")
        .eq("client_id", userId)
        .order("created_at", { ascending: false })
    ]);

    if (projectsError) console.error("Error loading projects:", projectsError);
    if (invoicesError) console.error("Error loading invoices:", invoicesError);
    if (retainersError) console.error("Error loading retainers:", retainersError);

    document.getElementById("client-name").textContent = (profile && profile.full_name) || session.user.email;
    renderProjects(projects || []);
    renderInvoices(invoices || []);
    renderRetainers(retainers || []);
    renderPaymentBanners();

    document.getElementById("dashboard-content").classList.remove("hidden");
  }

  function initSignOut(supabaseClient) {
    const btn = document.getElementById("sign-out-button");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (supabaseClient) await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const supabaseClient = getSupabaseClient();
    currentSupabaseClient = supabaseClient;
    initSignOut(supabaseClient);

    if (!supabaseClient) {
      document.getElementById("config-warning").classList.remove("hidden");
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) {
      window.location.href = "login.html";
      return;
    }

    // El staff interno usa el panel admin, no este panel de cliente.
    const { data: profile } = await supabaseClient.from("profiles").select("is_staff").eq("id", data.session.user.id).single();
    if (profile && profile.is_staff) {
      window.location.href = "admin.html";
      return;
    }

    await loadDashboard(supabaseClient, data.session);
  });
})();
