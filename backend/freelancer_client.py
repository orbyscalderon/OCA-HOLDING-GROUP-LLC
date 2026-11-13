"""
OCA Holding Group LLC — Cliente de la API de Freelancer.com
-------------------------------------------------------------
Envoltorio delgado sobre la API pública de Freelancer (api de la app "OCA
Lead Finder", developers.freelancer.com) para:
  1. Buscar proyectos activos que coincidan con nuestros servicios
     (sitios web, apps web/móviles, e-commerce, software a medida, branding).
  2. Generar una propuesta borrador (monto, plazo, mensaje) por heurística
     simple — sin IA externa — que el staff revisa/edita antes de aprobar.
  3. Enviar la oferta real a Freelancer, solo cuando el staff ya la aprobó.

Variables de entorno requeridas (.env):
    FREELANCER_SELF_AUTH_TOKEN

Nunca se expone el token al frontend: todas las llamadas a Freelancer pasan
por este módulo, usado únicamente desde contact_api_fastapi.py con el
service_role de Supabase y la verificación de staff ya existente.
"""

import logging
import os
import time
from typing import Optional

import anthropic
import requests

logger = logging.getLogger("oca_freelancer_client")

FREELANCER_API_BASE = "https://www.freelancer.com/api"

# ----------------------------------------------------------------------------
# Mapeo servicio OCA -> IDs de "jobs" (skills/categorías) de Freelancer.
# Obtenidos en vivo desde GET /projects/0.1/jobs/ — ver comentario de cada
# bloque. Si Freelancer agrega categorías relevantes nuevas, solo hay que
# sumar su id aquí.
# ----------------------------------------------------------------------------
SERVICE_JOB_IDS: dict[str, list[int]] = {
    "website": [17, 2839, 2701, 69],  # Website Design, Website Development, Web Design, WordPress
    "webapp": [1031, 1088, 2382, 759, 500],  # Web Development, Full Stack Development, Web Application, React.js, Node.js
    "mobileapp": [44, 58, 59, 1067, 1314, 1315, 2158],  # Mobile App Development, iPhone, Android, iOS Development, React Native, Flutter, Android App Development
    "ecommerce": [137, 502, 1686, 371],  # eCommerce, Shopify, Shopify Development, Shopify Templates
    "software": [613, 116, 1992],  # Software Development, Software Architecture, Financial Software Development
    "branding": [97, 32, 2432, 20],  # Branding, Logo Design, Rebranding, Graphic Design
}

# Orden de prioridad para decidir el matched_service cuando un proyecto cae
# en varias categorías a la vez (ej. una tienda en línea con app móvil).
_SERVICE_PRIORITY = ["mobileapp", "ecommerce", "webapp", "website", "software", "branding"]

_JOB_ID_TO_SERVICE: dict[int, str] = {}
for _service in _SERVICE_PRIORITY:
    for _job_id in SERVICE_JOB_IDS[_service]:
        _JOB_ID_TO_SERVICE.setdefault(_job_id, _service)

ALL_JOB_IDS = sorted({job_id for ids in SERVICE_JOB_IDS.values() for job_id in ids})


class FreelancerApiError(Exception):
    pass


def _headers() -> dict:
    # Leído en cada llamada (no al importar el módulo) para no depender del
    # orden en que contact_api_fastapi.py importa este archivo vs. llama a
    # load_dotenv() — un token capturado como "" al importar se queda así
    # para siempre, aunque el .env se cargue correctamente después.
    token = os.environ.get("FREELANCER_SELF_AUTH_TOKEN", "")
    if not token:
        raise FreelancerApiError("FREELANCER_SELF_AUTH_TOKEN no está configurado")
    return {"freelancer-oauth-v1": token}


def _get(path: str, params: Optional[dict] = None) -> dict:
    response = requests.get(f"{FREELANCER_API_BASE}{path}", headers=_headers(), params=params, timeout=20)
    data = response.json()
    if response.status_code != 200 or data.get("status") != "success":
        logger.error("Freelancer API GET %s failed: %s", path, data)
        raise FreelancerApiError(data.get("message") or f"HTTP {response.status_code}")
    return data["result"]


def _post(path: str, json_body: dict) -> dict:
    response = requests.post(f"{FREELANCER_API_BASE}{path}", headers=_headers(), json=json_body, timeout=20)
    data = response.json()
    if response.status_code not in (200, 201) or data.get("status") != "success":
        logger.error("Freelancer API POST %s failed: %s", path, data)
        raise FreelancerApiError(data.get("message") or f"HTTP {response.status_code}")
    return data["result"]


_self_user_id_cache: Optional[int] = None


def get_self_user_id() -> int:
    """Id de nuestra propia cuenta de Freelancer (necesario como bidder_id
    al enviar una oferta). Se resuelve una sola vez y se cachea en memoria."""
    global _self_user_id_cache
    if _self_user_id_cache is None:
        result = _get("/users/0.1/self/")
        _self_user_id_cache = result["id"]
    return _self_user_id_cache


def infer_matched_service(project: dict) -> Optional[str]:
    for job in project.get("jobs") or []:
        service = _JOB_ID_TO_SERVICE.get(job.get("id"))
        if service:
            return service
    return None


def search_projects(limit: int = 30) -> list[dict]:
    """Busca proyectos activos en Freelancer dentro de nuestras categorías
    de servicio. Devuelve la lista cruda de proyectos tal como los entrega
    la API (ver infer_matched_service / build_lead_row para normalizarlos)."""
    params = [
        ("limit", limit),
        ("full_description", "true"),
        ("job_details", "true"),
        ("compact", "false"),
        ("sort_field", "time_submitted"),
    ]
    for job_id in ALL_JOB_IDS:
        params.append(("jobs[]", job_id))
    for project_type in ("fixed", "hourly"):
        params.append(("project_types[]", project_type))

    result = _get("/projects/0.1/projects/active/", params=params)
    return result.get("projects") or []


# ----------------------------------------------------------------------------
# Generador de propuesta borrador — heurística simple, sin IA externa. El
# staff siempre la revisa/edita desde el panel admin antes de aprobarla.
# ----------------------------------------------------------------------------

_SERVICE_PITCH = {
    "website": "building fast, modern institutional websites with a custom admin panel and technical SEO baked in",
    "webapp": "building custom web applications — dashboards, client portals and internal tools — frontend and backend",
    "mobileapp": "building native and hybrid mobile apps for iOS and Android, from MVP to app-store launch",
    "ecommerce": "building complete e-commerce stores with secure payments, inventory management and an optimized checkout",
    "software": "building custom software to automate processes and integrate systems, architected to scale",
    "branding": "designing visual identity, logo and brand systems as the foundation for digital products",
}

_DEFAULT_HOURLY_RATE = 35.0


def _draft_amount_and_period(project: dict) -> tuple[float, int]:
    budget = project.get("budget") or {}
    budget_min = budget.get("minimum")
    budget_max = budget.get("maximum")
    is_hourly = project.get("type") == "hourly"

    if is_hourly:
        amount = _DEFAULT_HOURLY_RATE
        if budget_min and budget_max:
            amount = max(budget_min, min(budget_max, _DEFAULT_HOURLY_RATE))
        elif budget_min:
            amount = max(budget_min, _DEFAULT_HOURLY_RATE)
        return round(amount, 2), 14

    # Fixed-price: oferta cerca del 65% del rango (ni el piso, que lee como
    # low-effort, ni el techo, que reduce las chances de respuesta inicial).
    if budget_min and budget_max:
        amount = budget_min + (budget_max - budget_min) * 0.65
    elif budget_max:
        amount = budget_max * 0.65
    elif budget_min:
        amount = budget_min * 1.15
    else:
        amount = 500.0

    if amount < 300:
        period = 7
    elif amount < 1500:
        period = 14
    elif amount < 5000:
        period = 21
    else:
        period = 30

    return round(amount, 2), period


def _draft_message(project: dict, matched_service: Optional[str]) -> str:
    title = project.get("title", "your project")
    pitch = _SERVICE_PITCH.get(matched_service, "building production-ready digital products, frontend and backend")
    return (
        f"Hi, I read your brief for \"{title}\" and it's a great fit for what we do at OCA Holding Group — "
        f"we're a US-registered (Wyoming) development studio {pitch}. "
        "We'd handle this end to end with clear milestones and regular updates, and we're happy to share "
        "relevant examples of similar work before you decide. Looking forward to discussing scope and timeline.\n\n"
        "— Orbys, OCA Holding Group LLC"
    )


def build_lead_row(project: dict) -> dict:
    """Normaliza un proyecto crudo de la API al shape de la tabla
    freelancer_leads, con la propuesta borrador ya generada."""
    matched_service = infer_matched_service(project)
    amount, period_days = _draft_amount_and_period(project)
    budget = project.get("budget") or {}
    currency = project.get("currency") or {}
    bid_stats = project.get("bid_stats") or {}
    seo_url = project.get("seo_url")
    submitted_unix = project.get("time_submitted") or project.get("submitdate")

    return {
        "freelancer_project_id": project["id"],
        "title": project.get("title") or "(sin título)",
        "seo_url": seo_url,
        "project_url": f"https://www.freelancer.com/projects/{seo_url}" if seo_url else None,
        "currency_code": currency.get("code"),
        "budget_min": budget.get("minimum"),
        "budget_max": budget.get("maximum"),
        "freelancer_project_type": project.get("type"),
        "matched_service": matched_service,
        "bid_count": bid_stats.get("bid_count"),
        "skills": [job.get("name") for job in (project.get("jobs") or []) if job.get("name")],
        "description": (project.get("description") or "")[:4000],
        "time_submitted": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(submitted_unix)) if submitted_unix else None,
        "status": "new",
        "draft_bid_amount": amount,
        "draft_period_days": period_days,
        "draft_message": _draft_message(project, matched_service),
    }


# ----------------------------------------------------------------------------
# Propuesta con IA — bajo demanda, un proyecto a la vez (no en cada búsqueda,
# que insertaría ~30 leads por corrida: generar con IA para todos sería lento
# y costoso sin necesidad). El staff la pide desde el panel admin solo para
# los proyectos que de verdad le interesan, con el botón "Generar con IA".
# ----------------------------------------------------------------------------

_AI_PROPOSAL_SYSTEM_PROMPT = """You write freelance project proposals for OCA Holding Group LLC, a \
US-registered (Wyoming) software development studio that builds websites, web \
applications, mobile apps, e-commerce stores, custom software, and branding/identity \
work — frontend and backend, end to end.

You will be given one real project brief from Freelancer.com. Write a short bid \
proposal for it. Rules:
- Actually read and respond to the specific brief — reference at least one or two \
  concrete details from the description (a feature they asked for, a constraint, a \
  technology they mentioned) to prove it was read, not skimmed.
- Briefly state a concrete, plausible approach for THIS project — not generic claims.
- State the proposed timeline using the given period in days, naturally in a sentence.
- Confident, professional, warm tone. No flattery, no filler, no exclamation marks.
- Do NOT invent specific past clients, project names, or portfolio pieces — OCA's \
  track record may be mentioned only in general terms (e.g. "we build production-ready \
  X") never as a fabricated specific case study.
- Plain text only — no markdown, no bullet points, no headers.
- 110-170 words.
- End on its own line with exactly: — Orbys, OCA Holding Group LLC
- Output ONLY the proposal text, nothing else — no preamble, no "Here's a proposal:"."""


def generate_ai_proposal(project: dict, matched_service: Optional[str], amount: float, currency_code: Optional[str], period_days: int) -> str:
    """Analiza el brief real del proyecto con Claude y redacta una propuesta
    específica — a diferencia de _draft_message (heurística genérica usada
    como borrador inicial al buscar), esto SÍ lee la descripción completa."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise FreelancerApiError("ANTHROPIC_API_KEY no está configurado")

    client = anthropic.Anthropic(api_key=api_key)

    budget = project.get("budget") or {}
    user_content = (
        f"Project title: {project.get('title', '(no title)')}\n"
        f"Our matched service category: {matched_service or 'uncategorized'}\n"
        f"Freelancer project type: {project.get('type', 'fixed')}\n"
        f"Budget range: {budget.get('minimum', '?')}-{budget.get('maximum', '?')} {currency_code or ''}\n"
        f"Skills/tags on the listing: {', '.join(job.get('name', '') for job in (project.get('jobs') or []))}\n"
        f"Our planned bid: {amount} {currency_code or ''}, delivered in {period_days} days\n\n"
        f"Full project description:\n{(project.get('description') or '').strip()}"
    )

    try:
        response = client.messages.create(
            model="claude-opus-5-5",
            max_tokens=1024,
            system=_AI_PROPOSAL_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except anthropic.AuthenticationError as exc:
        raise FreelancerApiError("ANTHROPIC_API_KEY inválida") from exc
    except anthropic.RateLimitError as exc:
        raise FreelancerApiError("Límite de uso de la API de Claude alcanzado, intenta de nuevo en un momento") from exc
    except anthropic.APIStatusError as exc:
        logger.error("Claude API error generating proposal: %s", exc)
        raise FreelancerApiError(f"Error de la API de Claude: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise FreelancerApiError("No se pudo conectar con la API de Claude") from exc

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise FreelancerApiError("Claude no devolvió texto de propuesta")
    return text


def place_bid(project_id: int, amount: float, period_days: int, description: str, milestone_percentage: int = 100) -> dict:
    """Envía la oferta real a Freelancer. Solo debe llamarse para leads ya
    aprobados por el staff — ver /api/admin/freelancer/{lead_id}/submit-bid."""
    body = {
        "project_id": project_id,
        "bidder_id": get_self_user_id(),
        "amount": amount,
        "period": period_days,
        "milestone_percentage": milestone_percentage,
        "description": description,
    }
    return _post("/projects/0.1/bids/", body)
