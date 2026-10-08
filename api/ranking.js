// ============================================================================
// API: CONSULTA AUTORIZADA DE RANKING (GOOGLE APPS SCRIPT SERVIDOR A SERVIDOR)
// Archivo: api/ranking.js
// ============================================================================
// REGLA DE NEGOCIO CONFIRMADA POR DIRECCIÓN:
// El cupo anual de vacaciones de Comerciales Renosur es de 26 días laborables.
// ============================================================================

const https = require('https');
const { URL } = require('url');

/**
 * MEDIDAS DE SEGURIDAD IMPLEMENTADAS:
 * 1. Acceso Servidor a Servidor mediante método POST y secreto compartido (RANKING_SHARED_SECRET).
 * 2. Cero credenciales ni URLs públicas predeterminadas (requiere variables de entorno explícitas).
 * 3. Verificación obligatoria de token JWT de Supabase Auth en servidor contra /auth/v1/user.
 * 4. Consulta autoritativa en BD (agentes_perfiles): rol, activo, must_change_password.
 * 5. Scoping por rol:
 *    - 'gerente' y 'comercial': Acceso permitido al ranking de puntos del equipo.
 *    - 'evaria': Denegado (HTTP 403 Forbidden).
 *    - Peticiones anónimas o sin sesión: Denegado (HTTP 401 Unauthorized).
 * 6. Manejo seguro de redirecciones 302/303 emitidas por Google Apps Script.
 * 7. Cabeceras anti-caché estrictas (private, no-cache, no-store, must-revalidate).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const RANKING_APPS_SCRIPT_URL = process.env.RANKING_APPS_SCRIPT_URL || process.env.GOOGLE_APPS_SCRIPT_URL || "";
const RANKING_SHARED_SECRET = process.env.RANKING_SHARED_SECRET || "";

let memoryCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 30 * 1000; // 30s de caché en memoria interna del servidor

function verifySupabaseToken(token, callback) {
  try {
    const authUrl = new URL('/auth/v1/user', SUPABASE_URL);
    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      timeout: 8000
    };

    const req = https.get(authUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const user = JSON.parse(raw);
            return callback(null, user);
          } catch (e) {
            return callback(new Error("Error parseando respuesta de autenticación"));
          }
        } else {
          return callback(new Error(`Token de sesión inválido o expirado (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Tiempo de espera agotado al validar la sesión con Supabase Auth"));
    });

    req.on('error', (err) => {
      return callback(err);
    });
  } catch (err) {
    return callback(err);
  }
}

/**
 * Consulta autoritativa en agentes_perfiles (servidor)
 */
function fetchUserProfile(token, user, callback) {
  try {
    const profileUrl = new URL(`/rest/v1/agentes_perfiles?user_id=eq.${user.id}&select=dni,nombre,rol,activo,must_change_password`, SUPABASE_URL);
    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      timeout: 8000
    };

    const req = https.get(profileUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const rows = JSON.parse(raw);
            if (Array.isArray(rows) && rows.length > 0) {
              return callback(null, rows[0]);
            }
            return callback(new Error("Perfil no encontrado en agentes_perfiles"));
          } catch (e) {
            return callback(new Error("Error parseando perfil"));
          }
        }
        return callback(new Error(`Error al consultar perfil (HTTP ${res.statusCode})`));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout al consultar agentes_perfiles"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

/**
 * Ejecuta una petición POST privada con secreto a Google Apps Script, siguiendo redirecciones 302/303.
 */
function fetchPrivateRanking(targetUrl, secret, callback) {
  const postData = JSON.stringify({
    action: 'getRanking',
    secret: secret,
    timestamp: Date.now()
  });

  function executeRequest(urlStr, method, body, redirectCount = 0) {
    if (redirectCount > 5) {
      return callback(new Error("Demasiadas redirecciones de Google Apps Script"));
    }

    try {
      const parsedUrl = new URL(urlStr);
      const headers = {
        'User-Agent': 'AsistenteComercial-Backend/1.0',
        'Accept': 'application/json, text/plain, */*'
      };

      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const options = {
        method: method,
        headers: headers,
        timeout: 14000
      };

      const req = https.request(parsedUrl, options, (res) => {
        const { statusCode } = res;

        // Redirección de Google Apps Script (301, 302, 303, 307, 308)
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          const redirectLocation = res.headers.location;
          let redirectUrl;
          try {
            redirectUrl = new URL(redirectLocation, urlStr);
          } catch (urlErr) {
            return callback(new Error("URL de redirección malformada: " + urlErr.message));
          }

          // Validación estricta del protocolo
          if (redirectUrl.protocol !== 'https:') {
            return callback(new Error("Protocolo de redirección inseguro: se requiere HTTPS"));
          }

          // Verificación de destino confiable (Allowlist estricta de dominios de ejecución de Google)
          const host = redirectUrl.hostname.toLowerCase();
          const isAllowedGoogleHost = host === 'script.googleusercontent.com' ||
                                     host.endsWith('.googleusercontent.com') ||
                                     host === 'script.google.com';

          if (!isAllowedGoogleHost) {
            return callback(new Error(`Destino de redirección no verificado o no confiable: ${host}. Abortando para proteger la integridad.`));
          }

          // Google Apps Script exige leer el resultado del doPost mediante GET en script.googleusercontent.com
          // SEGURIDAD: Se invoca estrictamente con GET, body = null y sin reenviar secretos ni cabeceras sensibles
          return executeRequest(redirectUrl.href, 'GET', null, redirectCount + 1);
        }

        if (statusCode !== 200) {
          return callback(new Error(`Google Apps Script respondió con código HTTP ${statusCode}`));
        }

        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            // Interpretar contrato de respuesta explícito de Google Apps Script
            if (data && (data.ok === false || data.success === false)) {
              const code = Number(data.code) || 502;
              const msg = data.error || "Error reportado por el receptor de ranking";
              return callback(new Error(`APPS_SCRIPT_ERROR:${code}:${msg}`));
            }
            if (Array.isArray(data)) {
              return callback(null, data);
            }
            if (data && data.ranking && Array.isArray(data.ranking)) {
              return callback(null, data.ranking);
            }
            if (data && data.data && Array.isArray(data.data)) {
              return callback(null, data.data);
            }
            return callback(new Error("Formato de respuesta de ranking no válido"));
          } catch (e) {
            return callback(new Error("Error parseando respuesta JSON de Google Apps Script: " + e.message));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        callback(new Error("Timeout al conectar con Google Apps Script"));
      });

      req.on('error', err => callback(err));

      if (method === 'POST' && body) {
        req.write(body);
      }
      req.end();
    } catch (err) {
      callback(err);
    }
  }

  executeRequest(targetUrl, 'POST', postData, 0);
}

module.exports = function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Cabeceras estrictas anti-caché privada
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verificación obligatoria de variables de entorno (Cero valores por defecto a producción)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !RANKING_APPS_SCRIPT_URL || !RANKING_SHARED_SECRET) {
    return res.status(503).json({
      success: false,
      error: "Configuración incompleta: Se requieren SUPABASE_URL, SUPABASE_ANON_KEY, RANKING_APPS_SCRIPT_URL y RANKING_SHARED_SECRET en las variables de entorno del servidor."
    });
  }

  // 2. Verificación obligatoria de cabecera Authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: "Acceso no autorizado: Se requiere sesión activa con token Bearer verificable."
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Acceso no autorizado: Token de sesión vacío."
    });
  }

  // 3. Validación de token con Supabase Auth
  verifySupabaseToken(token, (authErr, user) => {
    if (authErr || !user) {
      return res.status(401).json({
        success: false,
        error: "Sesión inválida o expirada. Por favor, inicia sesión de nuevo."
      });
    }

    // 4. Consulta de la fuente de verdad en servidor: agentes_perfiles
    fetchUserProfile(token, user, (profileErr, profile) => {
      if (profileErr || !profile) {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado: Perfil de usuario no registrado o no autorizado en el sistema."
        });
      }

      const dni = (profile.dni || '').trim().toUpperCase();
      const rol = (profile.rol || '').toLowerCase();
      const activo = profile.activo === true;
      const mustChangePassword = profile.must_change_password === true;

      // Comprobación de usuario inactivo
      if (!activo) {
        return res.status(403).json({
          success: false,
          error: "Cuenta desactivada por gerencia."
        });
      }

      // Comprobación de cambio obligatorio de contraseña (servidor)
      if (mustChangePassword) {
        return res.status(403).json({
          success: false,
          error: "Acceso bloqueado: Cambio obligatorio de contraseña pendiente. Debes actualizar tu contraseña personal antes de consultar el ranking.",
          mustChangePassword: true
        });
      }

      // Scoping por rol: Evaria denegado
      if (rol === 'evaria') {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado: El perfil Evaria no tiene acceso al módulo de ranking."
        });
      }

      // Roles permitidos: 'comercial' y 'gerente'
      if (rol !== 'comercial' && rol !== 'gerente') {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado: Rol no autorizado."
        });
      }

      const now = Date.now();
      const isForce = req.query && (req.query.force === 'true' || req.query.fresh === '1');

      // Servir desde caché fresca interna solo a usuarios ya autenticados
      if (!isForce && memoryCache.data && (now - memoryCache.timestamp < CACHE_TTL_MS)) {
        res.setHeader('X-Cache-Status', 'HIT');
        return res.status(200).json(memoryCache.data);
      }

      // Petición privada Servidor a Servidor con secreto compartido
      fetchPrivateRanking(RANKING_APPS_SCRIPT_URL, RANKING_SHARED_SECRET, (err, rankingData) => {
        if (err) {
          if (memoryCache.data) {
            res.setHeader('X-Cache-Fallback', 'true');
            return res.status(200).json(memoryCache.data);
          }
          // Traducir contrato de error de Google Apps Script a código HTTP real
          if (err.message && err.message.startsWith('APPS_SCRIPT_ERROR:')) {
            const parts = err.message.split(':');
            const httpCode = parseInt(parts[1], 10) || 502;
            const msg = parts.slice(2).join(':');
            return res.status(httpCode).json({
              success: false,
              code: httpCode,
              error: msg
            });
          }
          return res.status(502).json({
            success: false,
            error: "Error al consultar el servicio privado de Ranking",
            details: err.message
          });
        }

        memoryCache.data = rankingData;
        memoryCache.timestamp = Date.now();
        res.setHeader('X-Cache-Status', 'MISS');
        return res.status(200).json(rankingData);
      });
    });
  });
};

module.exports.fetchPrivateRanking = fetchPrivateRanking;

