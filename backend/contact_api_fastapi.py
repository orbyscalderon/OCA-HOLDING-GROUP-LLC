"""
OCA Holding Group LLC — API de Contacto, Cotizaciones y Pagos (Python / FastAPI)
-------------------------------------------------------------
Rutas:
    POST /api/contact                    -> formulario de /contacto.html
    POST /api/create-checkout-session     -> link de pago único (Stripe Checkout) para una factura
    POST /api/create-subscription-checkout -> link de suscripción (Stripe Checkout) para un retainer
    POST /api/cancel-subscription         -> cancela un retainer activo (requiere ser el dueño)
    POST /api/stripe-webhook              -> confirma pagos/suscripciones y sincroniza su estado

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

import logging
import os
from datetime import datetime, timezone
from typing import Literal, Optional

import resend
import stripe
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
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

logger = logging.getLogger("oca_contact_api")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="OCA Holding Group — Contact API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configurable vía env var para poder probar contra el dominio real Y el
# preview de GitHub Pages a la vez durante la transición (separar por comas).
# Ej: ALLOWED_ORIGINS=https://www.ocaholdinggroup.com,https://orbyscalderon.github.io
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://www.ocaholdinggroup.com,https://orbyscalderon.github.io",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health_check():
    """Usado por Railway (railway.json -> healthcheckPath) para confirmar
    que el servicio arrancó correctamente. No requiere autenticación."""
    return {"status": "ok"}


def get_authenticated_user_id(authorization: Optional[str]) -> str:
    """
    Verifica el JWT de sesión de Supabase que el navegador manda en el
    header "Authorization: Bearer <token>" (dashboard.js/admin.js lo
    obtienen con supabaseClient.auth.getSession()). Devuelve el user id
    real, verificado contra Supabase Auth — nunca confiar en un client_id
    que venga suelto en el cuerpo de la petición.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing_authorization")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        user_response = supabase.auth.get_user(token)
    except Exception as exc:  # noqa: BLE001 — cualquier fallo de verificación es un 401
        raise HTTPException(status_code=401, detail="invalid_token") from exc

    if not user_response or not user_response.user:
        raise HTTPException(status_code=401, detail="invalid_token")

    return user_response.user.id


def assert_owner_or_staff(user_id: str, resource_client_id: str) -> None:
    """Permite la acción si el usuario autenticado es el dueño del recurso,
    o si es staff interno (profiles.is_staff). Lanza 403 en caso contrario."""
    if user_id == resource_client_id:
        return
    try:
        profile = supabase.table("profiles").select("is_staff").eq("id", user_id).single().execute()
        if profile.data and profile.data.get("is_staff"):
            return
    except Exception:  # noqa: BLE001 — si falla la verificación, no se concede acceso
        pass
    raise HTTPException(status_code=403, detail="forbidden")


def send_transactional_email(to: str, subject: str, text: str) -> None:
    """Envía un correo transaccional (confirmación al cliente, aviso de pago).
    A diferencia de la notificación interna al staff, un fallo aquí no debe
    tumbar la petición que lo dispara — el registro o el pago ya se
    confirmaron/guardaron en la base de datos — así que solo se registra."""
    try:
        resend.Emails.send(
            {
                "from": "OCA Holding Group <no-reply@ocaholdinggroup.com>",
                "to": to,
                "subject": subject,
                "text": text,
            }
        )
    except Exception:  # noqa: BLE001 — un correo fallido no debe romper el flujo principal
        logger.exception("No se pudo enviar el correo '%s' a %s", subject, to)


def get_client_email(client_id: str) -> Optional[str]:
    try:
        profile = supabase.table("profiles").select("email").eq("id", client_id).single().execute()
        return profile.data.get("email") if profile.data else None
    except Exception:  # noqa: BLE001 — sin email no se notifica, pero el pago ya quedó registrado
        logger.exception("No se pudo obtener el email del cliente %s", client_id)
        return None


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

        try:
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
        except Exception:  # noqa: BLE001 — la solicitud ya se guardó; un correo fallido no la invalida
            logger.exception("No se pudo notificar al staff sobre la solicitud %s", inserted_id)

        send_transactional_email(
            to=payload.email,
            subject="Recibimos tu solicitud — OCA Holding Group / We received your request",
            text=(
                f"Hola {payload.full_name},\n\n"
                "Recibimos tu solicitud y te contactaremos en menos de 1 día hábil.\n"
                "Si tienes algo que agregar, simplemente responde este correo.\n\n"
                "— Equipo OCA Holding Group\n\n"
                "----------\n\n"
                f"Hi {payload.full_name},\n\n"
                "We received your request and will get back to you within 1 business day.\n"
                "If you'd like to add anything, just reply to this email.\n\n"
                "— OCA Holding Group Team"
            ),
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
async def create_checkout_session(
    request: Request, payload: CreateCheckoutSessionPayload, authorization: Optional[str] = Header(default=None)
):
    """
    Crea una Stripe Checkout Session para una factura existente y devuelve
    la URL de pago. El monto NUNCA lo decide el navegador: siempre se lee
    de la tabla `invoices` con la service_role key. Requiere que quien pide
    el link sea el dueño de la factura (o staff) — verificado por JWT, no
    por un client_id que venga en el cuerpo de la petición.
    """
    user_id = get_authenticated_user_id(authorization)

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
        # PGRST116 = PostgREST "no rows returned" por .single(): eso sí es un
        # 404 genuino. Cualquier otro error (red, auth, Supabase caído) NO
        # debe reportarse como "factura no encontrada" — hay que distinguirlo
        # y registrarlo, o una caída real de la base de datos se vería igual
        # que una factura inexistente.
        if getattr(exc, "code", None) == "PGRST116":
            raise HTTPException(status_code=404, detail="invoice_not_found") from exc
        logger.error("create_checkout_session lookup error: %s", exc)
        raise HTTPException(status_code=500, detail="internal_error") from exc

    if not invoice:
        raise HTTPException(status_code=404, detail="invoice_not_found")

    assert_owner_or_staff(user_id, invoice["client_id"])

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


class RetainerActionPayload(BaseModel):
    retainer_id: str = Field(alias="retainerId")

    class Config:
        populate_by_name = True


@app.post("/api/create-subscription-checkout")
@limiter.limit("20/15minute")
async def create_subscription_checkout(
    request: Request, payload: RetainerActionPayload, authorization: Optional[str] = Header(default=None)
):
    """
    Igual que /api/create-checkout-session, pero en modo suscripción: Stripe
    cobra automáticamente cada `billing_interval` sin que nadie tenga que
    volver a generar una factura a mano. El precio se define aquí mismo
    (price_data) con los datos ya guardados en `retainers` — no requiere
    tener un Price pre-creado en el dashboard de Stripe.
    """
    user_id = get_authenticated_user_id(authorization)

    try:
        result = (
            supabase.table("retainers")
            .select("id, description, amount_cents, currency, billing_interval, status, client_id")
            .eq("id", payload.retainer_id)
            .single()
            .execute()
        )
        retainer = result.data
    except Exception as exc:
        if getattr(exc, "code", None) == "PGRST116":
            raise HTTPException(status_code=404, detail="retainer_not_found") from exc
        logger.error("create_subscription_checkout lookup error: %s", exc)
        raise HTTPException(status_code=500, detail="internal_error") from exc

    if not retainer:
        raise HTTPException(status_code=404, detail="retainer_not_found")

    assert_owner_or_staff(user_id, retainer["client_id"])

    if retainer["status"] == "active":
        raise HTTPException(status_code=400, detail="retainer_already_active")

    client_email = None
    try:
        user_response = supabase.auth.admin.get_user_by_id(retainer["client_id"])
        client_email = user_response.user.email if user_response and user_response.user else None
    except Exception:  # noqa: BLE001 — el email es solo para prellenar Checkout, no es crítico
        pass

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            customer_email=client_email,
            line_items=[
                {
                    "price_data": {
                        "currency": retainer["currency"] or "usd",
                        "product_data": {"name": retainer["description"]},
                        "unit_amount": retainer["amount_cents"],
                        "recurring": {"interval": retainer["billing_interval"]},
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{SITE_URL}/dashboard.html?subscription=success",
            cancel_url=f"{SITE_URL}/dashboard.html?subscription=canceled",
            metadata={"retainer_id": retainer["id"]},
        )

        supabase.table("retainers").update({"stripe_checkout_session_id": session.id}).eq(
            "id", retainer["id"]
        ).execute()

        return {"ok": True, "url": session.url}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="internal_error") from exc


@app.post("/api/cancel-subscription")
@limiter.limit("20/15minute")
async def cancel_subscription(
    request: Request, payload: RetainerActionPayload, authorization: Optional[str] = Header(default=None)
):
    """Cancela un retainer activo. El cliente solo puede cancelar el suyo;
    el staff puede cancelar cualquiera. La cancelación es inmediata (no
    "al final del período") para mantener el modelo simple."""
    user_id = get_authenticated_user_id(authorization)

    try:
        result = (
            supabase.table("retainers")
            .select("id, client_id, status, stripe_subscription_id")
            .eq("id", payload.retainer_id)
            .single()
            .execute()
        )
        retainer = result.data
    except Exception as exc:
        if getattr(exc, "code", None) == "PGRST116":
            raise HTTPException(status_code=404, detail="retainer_not_found") from exc
        logger.error("cancel_subscription lookup error: %s", exc)
        raise HTTPException(status_code=500, detail="internal_error") from exc

    if not retainer:
        raise HTTPException(status_code=404, detail="retainer_not_found")

    assert_owner_or_staff(user_id, retainer["client_id"])

    if not retainer["stripe_subscription_id"]:
        raise HTTPException(status_code=400, detail="retainer_not_active")

    try:
        stripe.Subscription.delete(retainer["stripe_subscription_id"])
    except Exception as exc:
        logger.error("cancel_subscription stripe error: %s", exc)
        raise HTTPException(status_code=500, detail="internal_error") from exc

    # Actualiza de inmediato para que la UI refleje el cambio sin esperar el
    # webhook (que igual llegará y confirmará el mismo estado).
    supabase.table("retainers").update(
        {"status": "canceled", "canceled_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", retainer["id"]).execute()

    return {"ok": True}


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
        metadata = session.get("metadata") or {}

        invoice_id = metadata.get("invoice_id")
        if invoice_id:
            invoice_row = (
                supabase.table("invoices")
                .update(
                    {
                        "status": "paid",
                        "paid_at": datetime.now(timezone.utc).isoformat(),
                        "stripe_payment_intent_id": session.get("payment_intent"),
                    }
                )
                .eq("id", invoice_id)
                .execute()
            )
            if invoice_row.data:
                invoice = invoice_row.data[0]
                client_email = get_client_email(invoice["client_id"])
                if client_email:
                    amount = invoice["amount_cents"] / 100
                    send_transactional_email(
                        to=client_email,
                        subject="Pago confirmado — OCA Holding Group / Payment confirmed",
                        text=(
                            f"Confirmamos tu pago de ${amount:,.2f} {invoice['currency'].upper()} "
                            f"por: {invoice['description']}.\n\n"
                            "— Equipo OCA Holding Group\n\n"
                            "----------\n\n"
                            f"We confirmed your payment of ${amount:,.2f} {invoice['currency'].upper()} "
                            f"for: {invoice['description']}.\n\n"
                            "— OCA Holding Group Team"
                        ),
                    )

        retainer_id = metadata.get("retainer_id")
        if retainer_id and session.get("mode") == "subscription":
            # La primera cobranza de la suscripción se confirmó: guardamos
            # los ids de Stripe y activamos el retainer. A partir de aquí,
            # las renovaciones automáticas las reporta customer.subscription.updated.
            retainer_row = (
                supabase.table("retainers")
                .update(
                    {
                        "status": "active",
                        "stripe_subscription_id": session.get("subscription"),
                        "stripe_customer_id": session.get("customer"),
                    }
                )
                .eq("id", retainer_id)
                .execute()
            )
            if retainer_row.data:
                retainer = retainer_row.data[0]
                client_email = get_client_email(retainer["client_id"])
                if client_email:
                    amount = retainer["amount_cents"] / 100
                    interval_es = "mes" if retainer["billing_interval"] == "month" else "año"
                    send_transactional_email(
                        to=client_email,
                        subject="Retainer activado — OCA Holding Group / Retainer activated",
                        text=(
                            f"Tu retainer de mantenimiento quedó activo: {retainer['description']} "
                            f"(${amount:,.2f} {retainer['currency'].upper()} por {interval_es}). "
                            "Se cobrará automáticamente cada período — puedes cancelarlo cuando "
                            "quieras desde tu panel.\n\n"
                            "— Equipo OCA Holding Group\n\n"
                            "----------\n\n"
                            f"Your maintenance retainer is now active: {retainer['description']} "
                            f"(${amount:,.2f} {retainer['currency'].upper()} per {retainer['billing_interval']}). "
                            "It will bill automatically each period — you can cancel anytime from "
                            "your dashboard.\n\n"
                            "— OCA Holding Group Team"
                        ),
                    )

    elif event["type"] == "customer.subscription.updated":
        subscription = event["data"]["object"]
        # Stripe usa: active, past_due, canceled, unpaid, incomplete,
        # incomplete_expired, trialing, paused. Solo nos importan los que
        # tenemos modelados; el resto (incomplete/trialing/paused) los
        # dejamos como están hasta que se resuelvan a uno de estos.
        status_map = {
            "active": "active",
            "past_due": "past_due",
            "canceled": "canceled",
            "unpaid": "unpaid",
        }
        new_status = status_map.get(subscription.get("status"))
        if new_status:
            update = {"status": new_status}
            if new_status == "canceled":
                update["canceled_at"] = datetime.now(timezone.utc).isoformat()
            supabase.table("retainers").update(update).eq(
                "stripe_subscription_id", subscription.get("id")
            ).execute()

    elif event["type"] == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        supabase.table("retainers").update(
            {"status": "canceled", "canceled_at": datetime.now(timezone.utc).isoformat()}
        ).eq("stripe_subscription_id", subscription.get("id")).execute()

    return {"received": True}
