// ============================================================================
// CONFIGURACIÓN DE ENTORNO CLIENTE - ASISTENTE COMERCIAL
// Archivo: config.js
// ============================================================================
// Cargado en <head> en index.html y login.html antes de inicializar clientes.
// En staging o producción, contiene las variables públicas del entorno correspondiente.
// CERO secretos de servidor ni claves administrativas (Service Role) deben incluirse aquí.
// ============================================================================
window.APP_CONFIG = window.APP_CONFIG || {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  ENVIRONMENT: "staging"
};
