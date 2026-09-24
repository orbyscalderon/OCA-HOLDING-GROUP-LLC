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
--   4. profiles           -> datos de negocio del cliente, ligados a auth.users
--   5. projects           -> proyectos contratados, visibles en el portal de clientes
--   6. project_updates    -> bitácora de avance de cada proyecto
--   7. invoices           -> cobros por hito/entregable, vía Stripe Checkout
-- ============================================================================

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Trigger genérico para mantener `updated_at` — definido primero porque
-- companies y projects lo usan más abajo (una función debe existir antes
-- de que un CREATE TRIGGER pueda referenciarla).
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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
                    subject_type in ('Investment','Media','Partnerships','General','Quote')
                  ),
  message         text not null,
  status          text not null default 'new' check (
                    status in ('new','in_review','responded','archived')
                  ),
  -- Brief de proyecto: solo se completa cuando subject_type = 'Quote'
  -- (cotización de desarrollo). Todas estas columnas son opcionales para
  -- no romper las demás solicitudes de contacto.
  project_type          text check (
                           project_type is null or project_type in (
                             'website','webapp','mobileapp','ecommerce','software','branding','other'
                           )
                         ),
  project_description   text,
  project_key_features  text,
  project_target_audience text,
  project_budget         text check (
                           project_budget is null or project_budget in (
                             'under5k','5to15k','15to50k','over50k','tbd'
                           )
                         ),
  project_timeline       text check (
                           project_timeline is null or project_timeline in (
                             'urgent','1to3','3to6','flexible'
                           )
                         ),
  project_has_existing_brand text check (
                           project_has_existing_brand is null or project_has_existing_brand in ('yes','no','partial')
                         ),
  project_references      text,
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
-- 4. PROFILES — extiende auth.users (Supabase Auth) con datos del cliente
-- ----------------------------------------------------------------------------
-- No se crea una tabla propia de "usuarios": Supabase Auth ya gestiona
-- auth.users (email, password hash, sesiones). Esta tabla solo agrega los
-- campos de negocio, ligados 1:1 por id. Se completa automáticamente al
-- registrarse gracias al trigger handle_new_user() más abajo.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  company_name    text,
  phone           text,
  is_staff        boolean not null default false, -- true = equipo interno OCA (ve todos los proyectos)
  created_at      timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. PROJECTS — un proyecto contratado por un cliente (portal de clientes)
-- ----------------------------------------------------------------------------
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references profiles(id) on delete cascade,
  contact_request_id uuid references contact_requests(id), -- origen: la cotización que lo generó
  title           text not null,
  project_type    text check (
                    project_type is null or project_type in (
                      'website','webapp','mobileapp','ecommerce','software','branding','other'
                    )
                  ),
  status          text not null default 'brief_received' check (
                    status in (
                      'brief_received','in_design','in_development','in_review','delivered','on_hold'
                    )
                  ),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_projects_client_id on projects (client_id);

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. PROJECT_UPDATES — bitácora de avance visible para el cliente en el portal
-- ----------------------------------------------------------------------------
create table if not exists project_updates (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  title           text not null,       -- ej. "Diseño aprobado", "Backend desplegado a staging"
  description     text,
  created_by      uuid references profiles(id), -- miembro del equipo OCA que publicó el avance
  created_at      timestamptz not null default now()
);

create index if not exists idx_project_updates_project_id on project_updates (project_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 7. INVOICES — cobros por hitos/entregables, vía Stripe Checkout
-- ----------------------------------------------------------------------------
create table if not exists invoices (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects(id) on delete cascade,
  client_id               uuid not null references profiles(id),
  description             text not null,       -- ej. "Anticipo 50% — Desarrollo tienda en línea"
  amount_cents            integer not null check (amount_cents > 0),
  currency                text not null default 'usd',
  status                  text not null default 'pending' check (
                            status in ('pending','paid','failed','refunded','canceled')
                          ),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  created_at              timestamptz not null default now(),
  paid_at                 timestamptz
);

create index if not exists idx_invoices_project_id on invoices (project_id);
create index if not exists idx_invoices_client_id on invoices (client_id);
create index if not exists idx_invoices_status on invoices (status);

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

-- ----------------------------------------------------------------------------
-- RLS — PORTAL DE CLIENTES (profiles / projects / project_updates / invoices)
-- ----------------------------------------------------------------------------
-- Cada cliente autenticado (Supabase Auth) solo ve sus propios proyectos,
-- avances y facturas. El staff interno (profiles.is_staff = true) ve todo.
-- La gestión de proyectos/avances por parte del staff hoy se hace desde
-- Supabase Studio o un futuro panel admin — no hay una UI admin en este
-- sitio todavía. Los pagos (insert/update de invoices) solo los hace el
-- backend con la service_role key, nunca el cliente ni el navegador.

create or replace function is_staff_user()
returns boolean as $$
  select coalesce((select is_staff from profiles where id = auth.uid()), false);
$$ language sql stable security definer;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_updates enable row level security;
alter table invoices enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (id = auth.uid() or is_staff_user());

create policy "Users can update their own profile"
  on profiles for update
  using (id = auth.uid());

create policy "Clients can view their own projects"
  on projects for select
  using (client_id = auth.uid() or is_staff_user());

create policy "Staff can manage projects"
  on projects for all
  using (is_staff_user())
  with check (is_staff_user());

create policy "Clients can view updates on their own projects"
  on project_updates for select
  using (
    exists (
      select 1 from projects p
      where p.id = project_updates.project_id
        and (p.client_id = auth.uid() or is_staff_user())
    )
  );

create policy "Staff can post project updates"
  on project_updates for insert
  with check (is_staff_user());

create policy "Clients can view their own invoices"
  on invoices for select
  using (client_id = auth.uid() or is_staff_user());

-- Sin política de insert/update para invoices: solo el backend
-- (service_role, que ignora RLS) crea facturas y las marca como pagadas
-- tras confirmar el webhook de Stripe. Ver backend/contact-api-node.js.
