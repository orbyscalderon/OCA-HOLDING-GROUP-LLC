"""
OCA Holding Group LLC — API de Contacto, Cotizaciones y Pagos (Python / FastAPI)
-------------------------------------------------------------
Rutas:
    POST /api/contact                 -> formulario de /contacto.html
    POST /api/create-checkout-session -> genera un link de pago de Stripe para una factura
    POST /api/stripe-webhook          -> confirma el pago y marca la factura como 'paid'

Alternativa en Python al backend Node.js (contact-api-node.js). Misma
responsabilidad: validar, persistir en Supabase/Postgres y notificar por
correo (Resend) o cobrar (Stripe).

Instalación:
    pip install fastapi uvicorn pydantic[email] supabase python-dotenv slowapi resend stripe

Variables de entorno requeridas (.env):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_TO_EMAIL,
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL

Ejecutar en desarrollo:
    uvicorn contact_api_fastapi:app --reload --port 3001
"""

import os
from datetime import datetime, timezone
from typing import Literal, Optional

import resend
import stripe
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
NOTIFY_TO_EMAIL = os.environ["NOTIFY_TO_EMAIL"]
SITE_URL = os.environ.get("SITE_URL", "https://www.ocaholdinggroup.com")
resend.api_key = os.environ["RESEND_API_KEY"]
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="OCA Holding Group — Contact API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.ocaholdinggroup.com"],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

# Mapea el valor de "department" enviado por el frontend (assets/js/main.js)
# al subject_type esperado por la base de datos.
DEPARTMENT_TO_SUBJECT_TYPE = {
    "investments": "Investment",
    "press": "Media",
    "partnerships": "Partnerships",
    "general": "General",
    "quote": "Quote",
}


class ProjectBrief(BaseModel):
    """Brief de proyecto — solo se envía cuando department == 'quote'."""

    type: Optional[Literal["website", "webapp", "mobileapp", "ecommerce", "software", "branding", "other"]] = None
    description: str = Field(min_length=20, max_length=4000)
    key_features: str = Field(default="", alias="keyFeatures", max_length=2000)
    target_audience: str = Field(default="", alias="targetAudience", max_length=500)
    budget: Literal["under5k", "5to15k", "15to50k", "over50k", "tbd"] = "tbd"
    timeline: Literal["urgent", "1to3", "3to6", "flexible"] = "flexible"
    has_existing_brand: Optional[Literal["yes", "no", "partial"]] = Field(default=None, alias="hasExistingBrand")
    references: str = Field(default="", max_length=1000)

    class Config:
        populate_by_name = True


class ContactPayload(BaseModel):
    full_name: str = Field(alias="fullName", min_length=2, max_length=200)
    email: EmailStr
    company: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    department: str
    message: str = Field(min_length=10, max_length=5000)
    project: Optional[ProjectBrief] = None

    @field_validator("department")
    @classmethod
    def validate_department(cls, value: str) -> str:
        if value not in DEPARTMENT_TO_SUBJECT_TYPE:
            raise ValueError("invalid department")
        return value

    @model_validator(mode="after")
    def validate_project_required_for_quote(self):
        if self.department == "quote" and self.project is None:
            raise ValueError("project brief is required when department is 'quote'")
        return self

    class Config:
        populate_by_name = True


@app.post("/api/contact", status_code=201)
@limiter.limit("10/15minute")
async def create_contact_request(request: Request, payload: ContactPayload):
    subject_type = DEPARTMENT_TO_SUBJECT_TYPE[payload.department]

    try:
        project = payload.project
        result = (
            supabase.table("contact_requests")
            .insert(
                {
                    "full_name": payload.full_name,
                    "email": payload.email,
                    "company_name": payload.company,
                    "phone": payload.phone,
                    "subject_type": subject_type,
                    "message": payload.message,
                    "project_type": project.type if project else None,
                    "project_description": project.description if project else None,
                    "project_key_features": project.key_features if project else None,
                    "project_target_audience": project.target_audience if project else None,
                    "project_budget": project.budget if project else None,
                    "project_timeline": project.timeline if project else None,
                    "project_has_existing_brand": project.has_existing_brand if project else None,
                    "project_references": project.references if project else None,
                }
            )
            .execute()
        )
        inserted_id = result.data[0]["id"]

        brief_text = ""
        if project:
            brief_text = (
                "\n\nBrief de proyecto:\n"
                f"Tipo: {project.type or '-'}\n"
                f"Descripción: {project.description}\n"
                f"Funcionalidades clave: {project.key_features or '-'}\n"
                f"Público objetivo: {project.target_audience or '-'}\n"
                f"Presupuesto: {project.budget}\n"
                f"Plazo: {project.timeline}\n"
                f"¿Marca existente?: {project.has_existing_brand or '-'}\n"
                f"Referencias: {project.references or '-'}"
            )

        resend.Emails.send(
            {
                "from": "OCA Holding Group <no-reply@ocaholdinggroup.com>",
                "to": NOTIFY_TO_EMAIL,
                "reply_to": payload.email,
                "subject": f"[{subject_type}] Nuevo contacto de {payload.full_name}",
                "text": (
                    f"Departamento: {subject_type}\n"
                    f"Nombre: {payload.full_name}\n"
                    f"Email: {payload.email}\n"
                    f"Empresa: {payload.company or '-'}\n"
                    f"Teléfono: {payload.phone or '-'}\n\n"
                    f"Mensaje:\n{payload.message}"
                    f"{brief_text}"
                ),
            }
        )

        return {"ok": True, "id": inserted_id}

    except Exception as exc:  # noqa: BLE001 — límite de un handler genérico para el endpoint
        raise HTTPException(status_code=500, detail="internal_error") from exc


class CreateCheckoutSessionPayload(BaseModel):
    invoice_id: str = Field(alias="invoiceId")

    class Config:
        populate_by_name = True


@app.post("/api/create-checkout-session")
@limiter.limit("20/15minute")
async def create_checkout_session(request: Request, payload: CreateCheckoutSessionPayload):
    """
    Crea una Stripe Checkout Session para una factura existente y devuelve
    la URL de pago. El monto NUNCA lo decide el navegador: siempre se lee
    de la tabla `invoices` con la service_role key.
    """
    try:
        result = (
            supabase.table("invoices")
            .select("id, description, amount_cents, currency, status, client_id")
            .eq("id", payload.invoice_id)
            .single()
            .execute()
        )
        invoice = result.data
    except Exception as exc:
        raise HTTPException(status_code=404, detail="invoice_not_found") from exc

    if not invoice:
        raise HTTPException(status_code=404, detail="invoice_not_found")
    if invoice["status"] == "paid":
        raise HTTPException(status_code=400, detail="invoice_already_paid")

    client_email = None
    try:
        user_response = supabase.auth.admin.get_user_by_id(invoice["client_id"])
        client_email = user_response.user.email if user_response and user_response.user else None
    except Exception:  # noqa: BLE001 — el email es solo para prellenar Checkout, no es crítico
        pass

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            customer_email=client_email,
            line_items=[
                {
                    "price_data": {
                        "currency": invoice["currency"] or "usd",
                        "product_data": {"name": invoice["description"]},
                        "unit_amount": invoice["amount_cents"],
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{SITE_URL}/dashboard.html?payment=success",
            cancel_url=f"{SITE_URL}/dashboard.html?payment=canceled",
            metadata={"invoice_id": invoice["id"]},
        )

        supabase.table("invoices").update({"stripe_checkout_session_id": session.id}).eq(
            "id", invoice["id"]
        ).execute()

        return {"ok": True, "url": session.url}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="internal_error") from exc


@app.post("/api/stripe-webhook")
async def stripe_webhook(request: Request):
    """
    Stripe firma el cuerpo CRUDO de la petición — a diferencia de /api/contact,
    aquí se lee request.body() directamente en vez de un modelo Pydantic, para
    no alterar los bytes antes de verificar la firma.
    """
    payload_bytes = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload_bytes, signature, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail=f"Webhook Error: {exc}") from exc

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        invoice_id = (session.get("metadata") or {}).get("invoice_id")
        if invoice_id:
            supabase.table("invoices").update(
                {
                    "status": "paid",
                    "paid_at": datetime.now(timezone.utc).isoformat(),
                    "stripe_payment_intent_id": session.get("payment_intent"),
                }
            ).eq("id", invoice_id).execute()

    return {"received": True}
