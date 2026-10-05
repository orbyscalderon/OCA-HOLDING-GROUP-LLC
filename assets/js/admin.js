/**
 * OCA Holding Group LLC — Panel Admin (admin.html)
 * ---------------------------------------------------------------
 * Herramienta interna para el equipo de OCA: ver solicitudes de cotización,
 * crear/gestionar proyectos y publicar avances, y crear facturas. Todo pasa
 * por Row Level Security (backend/schema.sql): estas operaciones solo
 * funcionan si el usuario autenticado tiene profiles.is_staff = true.
 * Nota importante: una factura NUNCA se puede marcar "paid" desde aquí —
 * ese estado solo lo asigna el webhook de Stripe tras confirmar el cobro.
 */
(function () {
  "use strict";

  const STATUS_LABELS = {
    brief_received: "Brief recibido",
    in_design: "En diseño",
    in_development: "En desarrollo",
    in_review: "En revisión",
    delivered: "Entregado",
    on_hold: "En pausa"
  };
  const INVOICE_STATUS_LABELS = { pending: "Pendiente", paid: "Pagada", failed: "Fallida", refunded: "Reembolsada", canceled: "Cancelada" };
  const RETAINER_STATUS_LABELS = { pending: "Pendiente de activar", active: "Activo", past_due: "Pago atrasado", unpaid: "Sin pagar", canceled: "Cancelado" };
  const PROJECT_TYPE_LABELS = {
    website: "Sitio web",
    webapp: "Aplicación web",
    mobileapp: "Aplicación móvil",
    ecommerce: "E-commerce",
    software: "Software a medida",
    branding: "Branding",
    other: "Otro"
  };

  function getSupabaseClient() {
    if (!window.OCA_SUPABASE_CONFIGURED || !window.supabase) return null;
    if (!window.__ocaSupabaseClient) {
      window.__ocaSupabaseClient = window.supabase.createClient(window.OCA_SUPABASE_URL, window.OCA_SUPABASE_ANON_KEY);
    }
    return window.__ocaSupabaseClient;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    try {
      return new Date(dateStr).toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return dateStr;
    }
  }

  function formatMoney(cents, currency) {
    try {
      return new Intl.NumberFormat("es-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(cents / 100);
    } catch (e) {
      return "$" + (cents / 100).toFixed(2);
    }
  }

  function showMessage(text, type) {
    const box = document.getElementById("admin-message");
    box.textContent = text;
    box.classList.remove("hidden", "bg-green-50", "text-green-700", "bg-red-50", "text-red-700");
    box.classList.add(type === "error" ? "bg-red-50" : "bg-green-50", type === "error" ? "text-red-700" : "text-green-700");
    setTimeout(() => box.classList.add("hidden"), 5000);
  }

  const PANEL_TITLES = {
    leads: "Solicitudes de Cotización",
    projects: "Proyectos",
    invoices: "Facturas",
    retainers: "Retainers"
  };

  function initTabs() {
    const tabs = document.querySelectorAll("[data-admin-tab]");
    const panels = document.querySelectorAll("[data-admin-panel]");
    const title = document.querySelector("[data-admin-panel-title]");
    function activate(name) {
      tabs.forEach((btn) => btn.classList.toggle("is-active", btn.getAttribute("data-admin-tab") === name));
      panels.forEach((panel) => panel.classList.toggle("hidden", panel.getAttribute("data-admin-panel") !== name));
      if (title) title.textContent = PANEL_TITLES[name] || "";
    }
    tabs.forEach((btn) => btn.addEventListener("click", () => activate(btn.getAttribute("data-admin-tab"))));
    activate("leads");
  }

  async function loadLeads(supabaseClient) {
    const { data, error } = await supabaseClient
      .from("contact_requests")
      .select("created_at, full_name, email, project_type, project_description, project_budget, project_timeline")
      .eq("subject_type", "Quote")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading leads:", error);
      return;
    }

    const statTotal = document.getElementById("stat-leads-total");
    const statWeek = document.getElementById("stat-leads-week");
    const statType = document.getElementById("stat-leads-type");
    if (statTotal) statTotal.textContent = data.length;
    if (statWeek) {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      statWeek.textContent = data.filter((l) => new Date(l.created_at).getTime() >= weekAgo).length;
    }
    if (statType) {
      const counts = {};
      data.forEach((l) => { if (l.project_type) counts[l.project_type] = (counts[l.project_type] || 0) + 1; });
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      statType.textContent = top ? PROJECT_TYPE_LABELS[top] || top : "—";
    }

    const tbody = document.getElementById("leads-table-body");
    if (!data.length) {
      tbody.innerHTML = emptyStateRow(7, "Aún no hay solicitudes de cotización.");
      return;
    }

    tbody.innerHTML = data
      .map(
        (lead) => `
      <tr>
        <td class="whitespace-nowrap">${formatDate(lead.created_at)}</td>
        <td>${escapeHtml(lead.full_name)}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${PROJECT_TYPE_LABELS[lead.project_type] || "-"}</td>
        <td class="max-w-xs">${escapeHtml(lead.project_description)}</td>
        <td class="whitespace-nowrap">${escapeHtml(lead.project_budget)}</td>
        <td class="whitespace-nowrap">${escapeHtml(lead.project_timeline)}</td>
      </tr>`
      )
      .join("");
  }

  async function loadProjects(supabaseClient) {
    const { data, error } = await supabaseClient
      .from("projects")
      .select("id, title, status, project_type, created_at, profiles(full_name, email), project_updates(id, title, description, created_at)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading projects:", error);
      return;
    }

    renderProjectsList(supabaseClient, data || []);
    populateInvoiceProjectSelect(data || []);
  }

  function renderProjectsList(supabaseClient, projects) {
    const statTotal = document.getElementById("stat-projects-total");
    const statActive = document.getElementById("stat-projects-active");
    const statDelivered = document.getElementById("stat-projects-delivered");
    if (statTotal) statTotal.textContent = projects.length;
    if (statActive) statActive.textContent = projects.filter((p) => p.status !== "delivered" && p.status !== "on_hold").length;
    if (statDelivered) statDelivered.textContent = projects.filter((p) => p.status === "delivered").length;

    const list = document.getElementById("projects-list");
    if (!projects.length) {
      list.innerHTML = `<div class="admin-empty-state rounded-2xl border border-slate-200 bg-white">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5a1.5 1.5 0 011.5-1.5h4.19a1.5 1.5 0 011.06.44l1.5 1.5a1.5 1.5 0 001.06.44H19.5a1.5 1.5 0 011.5 1.5v8.62a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-11z"/></svg>
        <span>Aún no hay proyectos. Crea el primero desde el formulario de la derecha.</span>
      </div>`;
      return;
    }

    list.innerHTML = projects
      .map((project) => {
        const client = project.profiles || {};
        const updates = (project.project_updates || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const updatesHtml = updates.length
          ? updates.map((u) => `<li class="text-xs text-slate-500"><span class="font-semibold text-navy">${escapeHtml(u.title)}</span> — ${formatDate(u.created_at)}</li>`).join("")
          : `<li class="text-xs text-slate-400">Sin avances publicados todavía.</li>`;

        const statusOptions = Object.keys(STATUS_LABELS)
          .map((s) => `<option value="${s}" ${s === project.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`)
          .join("");

        return `
        <article class="rounded-xl border border-slate-200 bg-white p-5" data-project-id="${project.id}">
          <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h3 class="font-serif text-base font-semibold text-navy">${escapeHtml(project.title)}</h3>
              <p class="text-xs text-slate-500">${escapeHtml(client.full_name || client.email || "Cliente")} · ${PROJECT_TYPE_LABELS[project.project_type] || "-"}</p>
            </div>
            <select class="project-status-select rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-navy">${statusOptions}</select>
          </div>
          <ul class="space-y-1 mb-2">${updatesHtml}</ul>
          <div data-update-form-slot></div>
        </article>`;
      })
      .join("");

    // Inserta el formulario de "publicar avance" (desde <template>) en cada tarjeta
    const template = document.getElementById("update-form-template");
    list.querySelectorAll("[data-update-form-slot]").forEach((slot) => {
      const clone = template.content.cloneNode(true);
      slot.appendChild(clone);
    });

    // Cambiar estado del proyecto
    list.querySelectorAll(".project-status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const projectId = select.closest("[data-project-id]").getAttribute("data-project-id");
        const { error } = await supabaseClient.from("projects").update({ status: select.value }).eq("id", projectId);
        if (error) showMessage("No se pudo actualizar el estado: " + error.message, "error");
        else showMessage("Estado actualizado.", "success");
      });
    });

    // Publicar avance
    list.querySelectorAll(".post-update-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const projectId = form.closest("[data-project-id]").getAttribute("data-project-id");
        const title = form.title.value.trim();
        const description = form.description.value.trim();
        if (!title) return;

        const { data: sessionData } = await supabaseClient.auth.getSession();
        const { error } = await supabaseClient.from("project_updates").insert({
          project_id: projectId,
          title,
          description: description || null,
          created_by: sessionData.session.user.id
        });

        if (error) {
          showMessage("No se pudo publicar el avance: " + error.message, "error");
        } else {
          showMessage("Avance publicado.", "success");
          form.reset();
          loadProjects(supabaseClient);
        }
      });
    });
  }

  function populateInvoiceProjectSelect(projects) {
    const select = document.getElementById("invoice-project-select");
    if (!select) return;
    select.innerHTML = projects
      .map((p) => `<option value="${p.id}">${escapeHtml(p.title)} — ${escapeHtml((p.profiles && (p.profiles.full_name || p.profiles.email)) || "Cliente")}</option>`)
      .join("");
  }

  async function loadInvoices(supabaseClient) {
    const { data, error } = await supabaseClient
      .from("invoices")
      .select("id, description, amount_cents, currency, status, created_at, projects(title)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading invoices:", error);
      return;
    }

    const statPaid = document.getElementById("stat-invoices-paid");
    const statPending = document.getElementById("stat-invoices-pending");
    const statCount = document.getElementById("stat-invoices-count");
    if (statCount) statCount.textContent = data.length;
    if (statPaid) {
      const total = data.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.amount_cents, 0);
      statPaid.textContent = formatMoney(total, "usd");
    }
    if (statPending) {
      const total = data.filter((i) => i.status === "pending").reduce((sum, i) => sum + i.amount_cents, 0);
      statPending.textContent = formatMoney(total, "usd");
    }

    const tbody = document.getElementById("invoices-table-body");
    if (!data.length) {
      tbody.innerHTML = emptyStateRow(5, "Aún no hay facturas.");
      return;
    }

    tbody.innerHTML = data
      .map(
        (inv) => `
      <tr>
        <td class="whitespace-nowrap">${formatDate(inv.created_at)}</td>
        <td>${escapeHtml((inv.projects && inv.projects.title) || "-")}</td>
        <td>${escapeHtml(inv.description)}</td>
        <td class="whitespace-nowrap font-semibold text-navy">${formatMoney(inv.amount_cents, inv.currency)}</td>
        <td><span class="status-pill status-${inv.status}">${INVOICE_STATUS_LABELS[inv.status] || inv.status}</span></td>
      </tr>`
      )
      .join("");
  }

  async function loadRetainers(supabaseClient) {
    const { data, error } = await supabaseClient
      .from("retainers")
      .select("id, description, amount_cents, currency, billing_interval, status, created_at, profiles(full_name, email)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading retainers:", error);
      return;
    }

    const statMrr = document.getElementById("stat-retainers-mrr");
    const statActive = document.getElementById("stat-retainers-active");
    const statPending = document.getElementById("stat-retainers-pending");
    const activeRetainers = data.filter((r) => r.status === "active");
    if (statActive) statActive.textContent = activeRetainers.length;
    if (statPending) statPending.textContent = data.filter((r) => r.status === "pending").length;
    if (statMrr) {
      const mrrCents = activeRetainers.reduce((sum, r) => sum + (r.billing_interval === "year" ? r.amount_cents / 12 : r.amount_cents), 0);
      statMrr.textContent = formatMoney(Math.round(mrrCents), "usd");
    }

    const tbody = document.getElementById("retainers-table-body");
    if (!data.length) {
      tbody.innerHTML = emptyStateRow(5, "Aún no hay retainers.");
      return;
    }

    tbody.innerHTML = data
      .map(
        (r) => `
      <tr>
        <td class="whitespace-nowrap">${formatDate(r.created_at)}</td>
        <td>${escapeHtml((r.profiles && (r.profiles.full_name || r.profiles.email)) || "-")}</td>
        <td>${escapeHtml(r.description)}</td>
        <td class="whitespace-nowrap font-semibold text-navy">${formatMoney(r.amount_cents, r.currency)} / ${r.billing_interval === "year" ? "año" : "mes"}</td>
        <td><span class="status-pill status-${r.status}">${RETAINER_STATUS_LABELS[r.status] || r.status}</span></td>
      </tr>`
      )
      .join("");
  }

  function initNewProjectForm(supabaseClient) {
    const form = document.getElementById("new-project-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-submit-button]");
      btn.disabled = true;

      const email = form.clientEmail.value.trim();
      const { data: client, error: clientError } = await supabaseClient.from("profiles").select("id").eq("email", email).maybeSingle();

      if (clientError || !client) {
        showMessage("No se encontró ningún cliente con ese correo. Debe crear su cuenta en el portal primero.", "error");
        btn.disabled = false;
        return;
      }

      const { error } = await supabaseClient.from("projects").insert({
        client_id: client.id,
        title: form.title.value.trim(),
        project_type: form.projectType.value,
        status: "brief_received"
      });

      btn.disabled = false;
      if (error) {
        showMessage("No se pudo crear el proyecto: " + error.message, "error");
      } else {
        showMessage("Proyecto creado.", "success");
        form.reset();
        loadProjects(supabaseClient);
      }
    });
  }

  function initNewInvoiceForm(supabaseClient) {
    const form = document.getElementById("new-invoice-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-submit-button]");
      btn.disabled = true;

      const projectId = form.projectId.value;
      const { data: project } = await supabaseClient.from("projects").select("client_id").eq("id", projectId).single();

      const amountCents = Math.round(parseFloat(form.amount.value) * 100);
      const { error } = await supabaseClient.from("invoices").insert({
        project_id: projectId,
        client_id: project.client_id,
        description: form.description.value.trim(),
        amount_cents: amountCents,
        currency: "usd",
        status: "pending"
      });

      btn.disabled = false;
      if (error) {
        showMessage("No se pudo crear la factura: " + error.message, "error");
      } else {
        showMessage("Factura creada.", "success");
        form.reset();
        loadInvoices(supabaseClient);
      }
    });
  }

  function initNewRetainerForm(supabaseClient) {
    const form = document.getElementById("new-retainer-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[data-submit-button]");
      btn.disabled = true;

      const email = form.clientEmail.value.trim();
      const { data: client, error: clientError } = await supabaseClient.from("profiles").select("id").eq("email", email).maybeSingle();

      if (clientError || !client) {
        showMessage("No se encontró ningún cliente con ese correo. Debe crear su cuenta en el portal primero.", "error");
        btn.disabled = false;
        return;
      }

      const amountCents = Math.round(parseFloat(form.amount.value) * 100);
      const { error } = await supabaseClient.from("retainers").insert({
        client_id: client.id,
        description: form.description.value.trim(),
        amount_cents: amountCents,
        currency: "usd",
        billing_interval: form.billingInterval.value,
        status: "pending"
      });

      btn.disabled = false;
      if (error) {
        showMessage("No se pudo crear el retainer: " + error.message, "error");
      } else {
        showMessage("Retainer creado. El cliente lo verá pendiente de activar en su panel.", "success");
        form.reset();
        loadRetainers(supabaseClient);
      }
    });
  }

  function initSignOut(supabaseClient) {
    const handler = async () => {
      if (supabaseClient) await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    };
    document.getElementById("sign-out-button").addEventListener("click", handler);
    const mobileBtn = document.getElementById("sign-out-button-mobile");
    if (mobileBtn) mobileBtn.addEventListener("click", handler);
  }

  function emptyStateRow(colspan, message) {
    return `<tr class="admin-empty-row"><td colspan="${colspan}"><div class="admin-empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5h3.75M9 10.5h6M3.75 18.75h16.5A1.5 1.5 0 0021.75 17.25V6.75a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v10.5a1.5 1.5 0 001.5 1.5z"/></svg>
      <span>${escapeHtml(message)}</span>
    </div></td></tr>`;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
      document.getElementById("access-denied").classList.remove("hidden");
      document.querySelector("#access-denied p").textContent = "El portal aún no está configurado (falta conectar Supabase).";
      return;
    }

    initSignOut(supabaseClient);

    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) {
      window.location.href = "login.html";
      return;
    }

    const { data: profile } = await supabaseClient.from("profiles").select("is_staff").eq("id", data.session.user.id).single();
    if (!profile || !profile.is_staff) {
      document.getElementById("access-denied").classList.remove("hidden");
      return;
    }

    document.getElementById("admin-content").classList.remove("hidden");
    initTabs();
    initNewProjectForm(supabaseClient);
    initNewInvoiceForm(supabaseClient);
    initNewRetainerForm(supabaseClient);

    await Promise.all([loadLeads(supabaseClient), loadProjects(supabaseClient), loadInvoices(supabaseClient), loadRetainers(supabaseClient)]);
  });
})();
