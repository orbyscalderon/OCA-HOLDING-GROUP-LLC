"""
OCA Holding Group LLC — API de Contacto (Python / FastAPI)
-------------------------------------------------------------
Ruta: POST /api/contact
Alternativa en Python al backend Node.js (contact-api-node.js). Misma
responsabilidad: validar, persistir en `contact_requests` (Supabase/Postgres)
y notificar por correo (SMTP o Resend).

Instalación:
    pip install fastapi uvicorn pydantic[email] supabase python-dotenv slowapi resend

Variables de entorno requeridas (.env):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_TO_EMAIL

Ejecutar en desarrollo:
    uvicorn contact_api_fastapi:app --reload --port 3001
"""

import os
from typing import Optional

import resend
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
NOTIFY_TO_EMAIL = os.environ["NOTIFY_TO_EMAIL"]
resend.api_key = os.environ["RESEND_API_KEY"]

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
}


class ContactPayload(BaseModel):
    full_name: str = Field(alias="fullName", min_length=2, max_length=200)
    email: EmailStr
    company: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    department: str
    message: str = Field(min_length=10, max_length=5000)

    @field_validator("department")
    @classmethod
    def validate_department(cls, value: str) -> str:
        if value not in DEPARTMENT_TO_SUBJECT_TYPE:
            raise ValueError("invalid department")
        return value

    class Config:
        populate_by_name = True


@app.post("/api/contact", status_code=201)
@limiter.limit("10/15minute")
async def create_contact_request(request: Request, payload: ContactPayload):
    subject_type = DEPARTMENT_TO_SUBJECT_TYPE[payload.department]

    try:
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
                }
            )
            .execute()
        )
        inserted_id = result.data[0]["id"]

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
                ),
            }
        )

        return {"ok": True, "id": inserted_id}

    except Exception as exc:  # noqa: BLE001 — límite de un handler genérico para el endpoint
        raise HTTPException(status_code=500, detail="internal_error") from exc
