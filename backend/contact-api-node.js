/**
 * OCA Holding Group LLC — API de Contacto (Node.js / Express)
 * ---------------------------------------------------------------
 * Ruta: POST /api/contact
 * Responsable de: validar el payload del formulario de /contacto.html,
 * persistirlo en la tabla `contact_requests` (ver /backend/schema.sql) y
 * notificar por correo vía Resend.
 *
 * Instalación:
 *   npm install express cors resend @supabase/supabase-js dotenv express-rate-limit
 *
 * Variables de entorno requeridas (.env, NUNCA committear valores reales):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *   NOTIFY_TO_EMAIL (buzón interno que recibe las notificaciones)
 */

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20kb" }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Limita abuso del endpoint público (10 solicitudes cada 15 min por IP)
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const VALID_SUBJECT_TYPES = ["Investment", "Media", "Partnerships", "General"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Traduce el valor de "department" enviado por el frontend (assets/js/main.js)
// al subject_type esperado por la base de datos.
const DEPARTMENT_TO_SUBJECT_TYPE = {
  investments: "Investment",
  press: "Media",
  partnerships: "Partnerships",
  general: "General"
};

function validatePayload(body) {
  const errors = [];
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const department = String(body.department || "").trim();

  if (fullName.length < 2) errors.push("fullName is required");
  if (!EMAIL_REGEX.test(email)) errors.push("a valid email is required");
  if (message.length < 10) errors.push("message must be at least 10 characters");
  if (!DEPARTMENT_TO_SUBJECT_TYPE[department]) errors.push("invalid department");

  return { errors, fullName, email, message, department };
}

app.post("/api/contact", contactLimiter, async (req, res) => {
  const { errors, fullName, email, message, department } = validatePayload(req.body);

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
        message
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // 2. Notificar por correo al equipo correspondiente
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
        `Mensaje:\n${message}`
    });

    return res.status(201).json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error("contact-api error:", err);
    return res.status(500).json({ ok: false, errors: ["internal_error"] });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OCA contact API listening on port ${PORT}`));

module.exports = app;
