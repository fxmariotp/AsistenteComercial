// ============================================================================
// PLANTILLA DE CONFIGURACIÓN DE ENTORNO CLIENTE (SIN SECRETOS)
// Archivo: config.example.js
// ============================================================================
// Instrucciones:
// 1. Copiar este archivo como config.js en la raíz del proyecto.
// 2. Rellenar con las credenciales públicas de Supabase para el entorno (Staging o Producción).
// 3. Este archivo es cargado en <head> por index.html y login.html antes de autenticar.
// ============================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://<tu-proyecto-supabase>.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  ENVIRONMENT: "staging"
};
