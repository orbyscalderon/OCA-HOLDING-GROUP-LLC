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

  async function getAuthHeaders(supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    return data && data.session ? { Authorization: "Bearer " + data.session.access_token } : {};
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

  const FREELANCER_STATUS_LABELS = { new: "Nuevo", approved: "Aprobado", submitted: "Oferta enviada", rejected: "Rechazado" };

  const PANEL_TITLES = {
    leads: "Solicitudes de Cotización",
    projects: "Proyectos",
    invoices: "Facturas",
    retainers: "Retainers",
    freelancer: "Freelancer"
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

  function formatBudgetRange(min, max, currency) {
    const cur = currency || "USD";
    if (min != null && max != null) return `${min.toLocaleString()}–${max.toLocaleString()} ${cur}`;
    if (min != null) return `desde ${min.toLocaleString()} ${cur}`;
    if (max != null) return `hasta ${max.toLocaleString()} ${cur}`;
    return "—";
  }

  async function loadFreelancerLeads(supabaseClient) {
    const { data, error } = await supabaseClient
      .from("freelancer_leads")
      .select("*")
      .order("time_submitted", { ascending: false });

    if (error) {
      console.error("Error loading freelancer leads:", error);
      return;
    }

    const statNew = document.getElementById("stat-freelancer-new");
    const statApproved = document.getElementById("stat-freelancer-approved");
    const statSubmitted = document.getElementById("stat-freelancer-submitted");
    if (statNew) statNew.textContent = data.filter((l) => l.status === "new").length;
    if (statApproved) statApproved.textContent = data.filter((l) => l.status === "approved").length;
    if (statSubmitted) statSubmitted.textContent = data.filter((l) => l.status === "submitted").length;

    renderFreelancerLeadsList(supabaseClient, data || []);
  }

  function renderFreelancerLeadsList(supabaseClient, leads) {
    const list = document.getElementById("freelancer-leads-list");
    if (!leads.length) {
      list.innerHTML = `<div class="admin-empty-state rounded-2xl border border-slate-200 bg-white">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.4"><path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25M21 7.5v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>
        <span>Aún no hay proyectos. Dale a "Buscar proyectos nuevos" para consultar Freelancer.com.</span>
      </div>`;
      return;
    }

    // Prioriza lo accionable: nuevos y aprobados primero, enviados/rechazados al final.
    const order = { new: 0, approved: 1, submitted: 2, rejected: 3 };
    const sorted = leads.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    list.innerHTML = sorted
      .map((lead) => {
        const readonly = lead.status === "submitted" || lead.status === "rejected";
        const descriptionPreview = (lead.description || "").slice(0, 280);
        const hasMore = (lead.description || "").length > 280;

        return `
        <article class="rounded-xl border border-slate-200 bg-white p-5" data-lead-id="${lead.id}">
          <div class="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div class="min-w-0">
              <a href="${escapeHtml(lead.project_url || "#")}" target="_blank" rel="noopener" class="font-serif text-base font-semibold text-navy hover:text-gold transition-colors">${escapeHtml(lead.title)}</a>
              <p class="text-xs text-slate-500 mt-0.5">
                ${PROJECT_TYPE_LABELS[lead.matched_service] || "Sin categoría"} ·
                ${formatBudgetRange(lead.budget_min, lead.budget_max, lead.currency_code)} ·
                ${lead.freelancer_project_type === "hourly" ? "Por hora" : "Precio fijo"} ·
                ${lead.bid_count != null ? lead.bid_count + " ofertas" : "—"}
              </p>
            </div>
            <span class="status-pill status-${lead.status}">${FREELANCER_STATUS_LABELS[lead.status] || lead.status}</span>
          </div>
          <p class="text-xs text-slate-500 mb-4">${escapeHtml(descriptionPreview)}${hasMore ? "…" : ""}</p>
          <form class="freelancer-draft-form space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-navy mb-1">Monto de la oferta (${escapeHtml(lead.currency_code || "USD")})</label>
                <input type="number" name="draftAmount" step="0.01" min="1" value="${lead.draft_bid_amount ?? ""}" ${readonly ? "disabled" : ""} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gold disabled:bg-slate-50 disabled:text-slate-400">
              </div>
              <div>
                <label class="block text-xs font-medium text-navy mb-1">Plazo (días)</label>
                <input type="number" name="draftPeriod" step="1" min="1" value="${lead.draft_period_days ?? ""}" ${readonly ? "disabled" : ""} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gold disabled:bg-slate-50 disabled:text-slate-400">
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-navy mb-1">Mensaje de la propuesta</label>
              <textarea name="draftMessage" rows="4" ${readonly ? "disabled" : ""} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-gold disabled:bg-slate-50 disabled:text-slate-400">${escapeHtml(lead.draft_message || "")}</textarea>
            </div>
            ${
              readonly
                ? ""
                : `<div class="flex flex-wrap gap-2 pt-1">
              <button type="button" data-lead-action="save" class="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-navy hover:border-navy transition-colors">Guardar cambios</button>
              <button type="button" data-lead-action="reject" class="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-700 hover:border-red-400 transition-colors">Rechazar</button>
              ${
                lead.status === "approved"
                  ? `<button type="button" data-lead-action="submit-bid" class="ml-auto rounded-full bg-gold px-5 py-2 text-xs font-semibold text-navy hover:bg-gold-light transition-colors">Enviar oferta a Freelancer →</button>`
                  : `<button type="button" data-lead-action="approve" class="ml-auto rounded-full bg-navy px-5 py-2 text-xs font-semibold text-white hover:bg-navy-light transition-colors">Guardar y aprobar</button>`
              }
            </div>`
            }
          </form>
        </article>`;
      })
      .join("");

    wireFreelancerLeadActions(supabaseClient, list);
  }

  function wireFreelancerLeadActions(supabaseClient, list) {
    list.querySelectorAll("[data-lead-id]").forEach((card) => {
      const leadId = card.getAttribute("data-lead-id");
      const form = card.querySelector(".freelancer-draft-form");
      if (!form) return;

      function readDraftFields() {
        return {
          draft_bid_amount: form.draftAmount.value ? parseFloat(form.draftAmount.value) : null,
          draft_period_days: form.draftPeriod.value ? parseInt(form.draftPeriod.value, 10) : null,
          draft_message: form.draftMessage.value.trim()
        };
      }

      const saveBtn = form.querySelector('[data-lead-action="save"]');
      const approveBtn = form.querySelector('[data-lead-action="approve"]');
      const rejectBtn = form.querySelector('[data-lead-action="reject"]');
      const submitBidBtn = form.querySelector('[data-lead-action="submit-bid"]');

      if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
          saveBtn.disabled = true;
          const { error } = await supabaseClient.from("freelancer_leads").update(readDraftFields()).eq("id", leadId);
          saveBtn.disabled = false;
          if (error) showMessage("No se pudo guardar: " + error.message, "error");
          else showMessage("Cambios guardados.", "success");
        });
      }

      if (approveBtn) {
        approveBtn.addEventListener("click", async () => {
          approveBtn.disabled = true;
          const fields = readDraftFields();
          if (!fields.draft_bid_amount || !fields.draft_period_days || !fields.draft_message) {
            showMessage("Completa monto, plazo y mensaje antes de aprobar.", "error");
            approveBtn.disabled = false;
            return;
          }
          const { error } = await supabaseClient
            .from("freelancer_leads")
            .update(Object.assign({ status: "approved" }, fields))
            .eq("id", leadId);
          approveBtn.disabled = false;
          if (error) {
            showMessage("No se pudo aprobar: " + error.message, "error");
          } else {
            showMessage("Propuesta aprobada. Ya puedes enviarla a Freelancer.", "success");
            loadFreelancerLeads(supabaseClient);
          }
        });
      }

      if (rejectBtn) {
        rejectBtn.addEventListener("click", async () => {
          rejectBtn.disabled = true;
          const { error } = await supabaseClient.from("freelancer_leads").update({ status: "rejected" }).eq("id", leadId);
          rejectBtn.disabled = false;
          if (error) showMessage("No se pudo rechazar: " + error.message, "error");
          else {
            showMessage("Proyecto descartado.", "success");
            loadFreelancerLeads(supabaseClient);
          }
        });
      }

      if (submitBidBtn) {
        submitBidBtn.addEventListener("click", async () => {
          if (!window.confirm("Esto envía la oferta REAL a Freelancer.com con los datos que ves aquí. ¿Confirmas?")) return;
          submitBidBtn.disabled = true;
          submitBidBtn.textContent = "Enviando…";
          try {
            const apiBase = window.OCA_API_BASE_URL || "";
            const response = await fetch(apiBase + "/api/admin/freelancer/" + leadId + "/submit-bid", {
              method: "POST",
              headers: Object.assign({ "Content-Type": "application/json" }, await getAuthHeaders(supabaseClient))
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.detail || "submit_failed");
            showMessage("Oferta enviada a Freelancer.", "success");
            loadFreelancerLeads(supabaseClient);
          } catch (err) {
            console.error("submit-bid error:", err);
            showMessage("No se pudo enviar la oferta: " + err.message, "error");
            submitBidBtn.disabled = false;
            submitBidBtn.textContent = "Enviar oferta a Freelancer →";
          }
        });
      }
    });
  }

  function initFreelancerSearchButton(supabaseClient) {
    const btn = document.getElementById("freelancer-search-button");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "Buscando…";
      try {
        const apiBase = window.OCA_API_BASE_URL || "";
        const response = await fetch(apiBase + "/api/admin/freelancer/search", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, await getAuthHeaders(supabaseClient))
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.detail || "search_failed");
        showMessage(`Encontrados ${data.found}, ${data.new_leads} nuevos.`, "success");
        loadFreelancerLeads(supabaseClient);
      } catch (err) {
        console.error("freelancer search error:", err);
        showMessage("No se pudo buscar: " + err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
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
    initFreelancerSearchButton(supabaseClient);

    await Promise.all([
      loadLeads(supabaseClient),
      loadProjects(supabaseClient),
      loadInvoices(supabaseClient),
      loadRetainers(supabaseClient),
      loadFreelancerLeads(supabaseClient)
    ]);
  });
})();
