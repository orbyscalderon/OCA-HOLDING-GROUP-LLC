/**
 * OCA Holding Group LLC — API de Contacto, Cotizaciones y Pagos (Node.js / Express)
 * ---------------------------------------------------------------
 * Rutas:
 *   POST /api/contact                 -> formulario de /contacto.html (ver validatePayload)
 *   POST /api/create-checkout-session -> genera un link de pago de Stripe para una factura
 *   POST /api/stripe-webhook          -> confirma el pago y marca la factura como 'paid'
 *
 * Instalación:
 *   npm install express cors resend @supabase/supabase-js dotenv express-rate-limit stripe
 *
 * Variables de entorno requeridas (.env, NUNCA committear valores reales):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *   NOTIFY_TO_EMAIL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL
 */

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");
require("dotenv").config();

const app = express();
app.use(cors());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------------------------------------------------------------------
// STRIPE WEBHOOK — debe registrarse ANTES de express.json() y con el parser
// "raw", porque Stripe firma el cuerpo crudo de la petición; si Express ya
// lo parseó a JSON, la verificación de firma (constructEvent) falla siempre.
// ----------------------------------------------------------------------------
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceId = session.metadata && session.metadata.invoice_id;
    if (invoiceId) {
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: session.payment_intent
        })
        .eq("id", invoiceId);
      if (error) console.error("Failed to mark invoice as paid:", error);
    }
  }

  res.status(200).json({ received: true });
});

// El resto de las rutas sí reciben JSON normal.
app.use(express.json({ limit: "20kb" }));

// Limita abuso del endpoint público (10 solicitudes cada 15 min por IP)
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PROJECT_TYPES = ["website", "webapp", "mobileapp", "ecommerce", "software", "branding", "other"];
const VALID_BUDGETS = ["under5k", "5to15k", "15to50k", "over50k", "tbd"];
const VALID_TIMELINES = ["urgent", "1to3", "3to6", "flexible"];
const VALID_HAS_BRAND = ["yes", "no", "partial"];

// Traduce el valor de "department" enviado por el frontend (assets/js/main.js)
// al subject_type esperado por la base de datos.
const DEPARTMENT_TO_SUBJECT_TYPE = {
  investments: "Investment",
  press: "Media",
  partnerships: "Partnerships",
  general: "General",
  quote: "Quote"
};

function validatePayload(body) {
  const errors = [];
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const department = String(body.department || "").trim();
  const isQuote = department === "quote";

  if (fullName.length < 2) errors.push("fullName is required");
  if (!EMAIL_REGEX.test(email)) errors.push("a valid email is required");
  if (message.length < 10) errors.push("message must be at least 10 characters");
  if (!DEPARTMENT_TO_SUBJECT_TYPE[department]) errors.push("invalid department");

  let project = null;
  if (isQuote) {
    const p = body.project || {};
    const description = String(p.description || "").trim();
    if (description.length < 20) errors.push("project.description must be at least 20 characters");
    project = {
      type: VALID_PROJECT_TYPES.includes(p.type) ? p.type : null,
      description,
      keyFeatures: String(p.keyFeatures || "").trim(),
      targetAudience: String(p.targetAudience || "").trim(),
      budget: VALID_BUDGETS.includes(p.budget) ? p.budget : "tbd",
      timeline: VALID_TIMELINES.includes(p.timeline) ? p.timeline : "flexible",
      hasExistingBrand: VALID_HAS_BRAND.includes(p.hasExistingBrand) ? p.hasExistingBrand : null,
      references: String(p.references || "").trim()
    };
  }

  return { errors, fullName, email, message, department, isQuote, project };
}

app.post("/api/contact", contactLimiter, async (req, res) => {
  const { errors, fullName, email, message, department, isQuote, project } = validatePayload(req.body);

  if (errors.length) {
    return res.status(400).json({ ok: false, errors });
  }

  const subjectType = DEPARTMENT_TO_SUBJECT_TYPE[department];
  const companyName = String(req.body.company || "").trim() || null;
  const phone = String(req.body.phone || "").trim() || null;

  try {
    // 1. Persistir la solicitud en Supabase/Postgres
    const { data: inserted, error: dbError } = await supabase
      .from("contact_requests")
      .insert({
        full_name: fullName,
        email,
        company_name: companyName,
        phone,
        subject_type: subjectType,
        message,
        project_type: project ? project.type : null,
        project_description: project ? project.description : null,
        project_key_features: project ? project.keyFeatures : null,
        project_target_audience: project ? project.targetAudience : null,
        project_budget: project ? project.budget : null,
        project_timeline: project ? project.timeline : null,
        project_has_existing_brand: project ? project.hasExistingBrand : null,
        project_references: project ? project.references : null
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // 2. Notificar por correo al equipo correspondiente
    const briefText = isQuote
      ? `\n\nBrief de proyecto:\n` +
        `Tipo: ${project.type || "-"}\n` +
        `Descripción: ${project.description}\n` +
        `Funcionalidades clave: ${project.keyFeatures || "-"}\n` +
        `Público objetivo: ${project.targetAudience || "-"}\n` +
        `Presupuesto: ${project.budget}\n` +
        `Plazo: ${project.timeline}\n` +
        `¿Marca existente?: ${project.hasExistingBrand || "-"}\n` +
        `Referencias: ${project.references || "-"}`
      : "";

    await resend.emails.send({
      from: "OCA Holding Group <no-reply@ocaholdinggroup.com>",
      to: process.env.NOTIFY_TO_EMAIL,
      reply_to: email,
      subject: `[${subjectType}] Nuevo contacto de ${fullName}`,
      text:
        `Departamento: ${subjectType}\n` +
        `Nombre: ${fullName}\n` +
        `Email: ${email}\n` +
        `Empresa: ${companyName || "-"}\n` +
        `Teléfono: ${phone || "-"}\n\n` +
        `Mensaje:\n${message}` +
        briefText
    });

    return res.status(201).json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error("contact-api error:", err);
    return res.status(500).json({ ok: false, errors: ["internal_error"] });
  }
});

// ----------------------------------------------------------------------------
// POST /api/create-checkout-session
// Recibe un invoiceId (tabla `invoices`), crea una Stripe Checkout Session
// por ese monto exacto y devuelve la URL de pago para redirigir al cliente
// desde dashboard.html. El monto NUNCA lo decide el navegador: siempre se
// lee de la base de datos con la service_role key.
// ----------------------------------------------------------------------------
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post("/api/create-checkout-session", checkoutLimiter, async (req, res) => {
  const invoiceId = String(req.body.invoiceId || "").trim();
  if (!invoiceId) return res.status(400).json({ ok: false, errors: ["invoiceId is required"] });

  try {
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, description, amount_cents, currency, status, client_id")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) return res.status(404).json({ ok: false, errors: ["invoice_not_found"] });
    if (invoice.status === "paid") return res.status(400).json({ ok: false, errors: ["invoice_already_paid"] });

    const { data: userData } = await supabase.auth.admin.getUserById(invoice.client_id);
    const clientEmail = userData && userData.user ? userData.user.email : undefined;

    const siteUrl = process.env.SITE_URL || "https://www.ocaholdinggroup.com";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: clientEmail,
      line_items: [
        {
          price_data: {
            currency: invoice.currency || "usd",
            product_data: { name: invoice.description },
            unit_amount: invoice.amount_cents
          },
          quantity: 1
        }
      ],
      success_url: `${siteUrl}/dashboard.html?payment=success`,
      cancel_url: `${siteUrl}/dashboard.html?payment=canceled`,
      metadata: { invoice_id: invoice.id }
    });

    await supabase.from("invoices").update({ stripe_checkout_session_id: session.id }).eq("id", invoice.id);

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ ok: false, errors: ["internal_error"] });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OCA contact API listening on port ${PORT}`));

module.exports = app;
