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

  function initTabs() {
    const tabs = document.querySelectorAll("[data-admin-tab]");
    const panels = document.querySelectorAll("[data-admin-panel]");
    function activate(name) {
      tabs.forEach((btn) => btn.classList.toggle("is-active", btn.getAttribute("data-admin-tab") === name));
      panels.forEach((panel) => panel.classList.toggle("hidden", panel.getAttribute("data-admin-panel") !== name));
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

    const tbody = document.getElementById("leads-table-body");
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-slate-400">Aún no hay solicitudes de cotización.</td></tr>`;
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
    const list = document.getElementById("projects-list");
    if (!projects.length) {
      list.innerHTML = `<p class="text-sm text-slate-400 rounded-lg border border-slate-200 bg-white p-6">Aún no hay proyectos. Crea el primero desde el formulario de la derecha.</p>`;
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

    const tbody = document.getElementById("invoices-table-body");
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-slate-400">Aún no hay facturas.</td></tr>`;
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
        <td><span class="status-pill bg-slate-100 text-slate-600">${INVOICE_STATUS_LABELS[inv.status] || inv.status}</span></td>
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

  function initSignOut(supabaseClient) {
    document.getElementById("sign-out-button").addEventListener("click", async () => {
      if (supabaseClient) await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });
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

    await Promise.all([loadLeads(supabaseClient), loadProjects(supabaseClient), loadInvoices(supabaseClient)]);
  });
})();
