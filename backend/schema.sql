-- ============================================================================
-- OCA Holding Group LLC — Esquema de base de datos (PostgreSQL / Supabase)
-- ----------------------------------------------------------------------------
-- Tablas:
--   1. companies          -> filiales del portafolio (fuente de /portafolio.html)
--   2. contact_requests   -> solicitudes recibidas desde /contacto.html
--   3. news_posts         -> comunicados/noticias (fuente de /noticias.html)
--      (extra, no solicitada explícitamente pero necesaria para persistir
--       lo que hoy vive en assets/js/data.js; puede omitirse si se prefiere
--       gestionar noticias como contenido estático/CMS)
-- ============================================================================

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. COMPANIES
-- ----------------------------------------------------------------------------
create table if not exists companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  sector          text not null check (
                    sector in ('technology','realestate','services','entertainment','energy','finance')
                  ),
  description     text not null,
  tagline         text,
  website_url     text,
  logo_url        text,
  is_active       boolean not null default true,
  joined_year     smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_companies_sector on companies (sector);
create index if not exists idx_companies_is_active on companies (is_active);

-- ----------------------------------------------------------------------------
-- 2. CONTACT_REQUESTS
-- ----------------------------------------------------------------------------
create table if not exists contact_requests (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  company_name    text,
  phone           text,
  subject_type    text not null check (
                    subject_type in ('Investment','Media','Partnerships','General')
                  ),
  message         text not null,
  status          text not null default 'new' check (
                    status in ('new','in_review','responded','archived')
                  ),
  created_at      timestamptz not null default now()
);

create index if not exists idx_contact_requests_subject_type on contact_requests (subject_type);
create index if not exists idx_contact_requests_created_at on contact_requests (created_at desc);

-- ----------------------------------------------------------------------------
-- 3. NEWS_POSTS (soporte para /noticias.html)
-- ----------------------------------------------------------------------------
create table if not exists news_posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  category        text not null check (
                    category in ('press','acquisition','milestone')
                  ),
  title_es        text not null,
  title_en        text not null,
  excerpt_es      text not null,
  excerpt_en      text not null,
  body_es         text not null,
  body_en         text not null,
  published_at    date not null default current_date,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_news_posts_category on news_posts (category);
create index if not exists idx_news_posts_published_at on news_posts (published_at desc);

-- ----------------------------------------------------------------------------
-- Trigger genérico para mantener `updated_at` en companies
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_companies_updated_at on companies;
create trigger trg_companies_updated_at
  before update on companies
  for each row execute function set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (Supabase)
-- ----------------------------------------------------------------------------
-- companies / news_posts: lectura pública, escritura solo para el rol de
-- servicio (backend). contact_requests: sin lectura pública (solo backend/
-- panel administrativo autenticado); inserción permitida vía función RPC o
-- API con la service_role key, nunca directamente desde el cliente anónimo
-- si el formulario envía datos sensibles.
-- ============================================================================

alter table companies enable row level security;
alter table news_posts enable row level security;
alter table contact_requests enable row level security;

create policy "Public read access to active companies"
  on companies for select
  using (is_active = true);

create policy "Public read access to published news"
  on news_posts for select
  using (is_published = true);

-- Sin política de SELECT/INSERT pública en contact_requests: todas las
-- operaciones pasan por el backend (service_role) o una Edge Function que
-- aplique rate-limiting y validación antes de insertar.
