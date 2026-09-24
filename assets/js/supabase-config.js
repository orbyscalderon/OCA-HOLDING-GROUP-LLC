/**
 * OCA Holding Group LLC — Configuración pública de Supabase (Portal de Clientes)
 * ---------------------------------------------------------------------------
 * Estos dos valores SON públicos por diseño: Supabase los protege con Row
 * Level Security (ver backend/schema.sql), no con secreto — por eso es
 * seguro incluirlos en un archivo JS que carga el navegador. Lo que NUNCA
 * debe ir aquí es la SUPABASE_SERVICE_ROLE_KEY (esa vive solo en el backend,
 * en backend/.env).
 *
 * Cómo obtener tus valores reales:
 *   Supabase Dashboard -> tu proyecto -> Project Settings -> API
 *     - "Project URL"      -> OCA_SUPABASE_URL
 *     - "anon public" key  -> OCA_SUPABASE_ANON_KEY
 *
 * Mientras estos sigan con el valor placeholder, login.html y dashboard.html
 * muestran un aviso en vez de intentar conectarse.
 */
window.OCA_SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.OCA_SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";

// URL base del backend (Node o FastAPI) donde vive /api/create-checkout-session.
// En desarrollo local suele ser http://localhost:3001
window.OCA_API_BASE_URL = "https://api.ocaholdinggroup.com";

window.OCA_SUPABASE_CONFIGURED =
  window.OCA_SUPABASE_URL.indexOf("YOUR-PROJECT-REF") === -1 &&
  window.OCA_SUPABASE_ANON_KEY.indexOf("YOUR_ANON_PUBLIC_KEY") === -1;
