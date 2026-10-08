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
const CACHE_TTL_MS = 30 * 1000; // 30s de caché fresca en memoria interna del servidor
const MAX_STALE_CACHE_MS = 5 * 60 * 1000; // 5 minutos de antigüedad máxima para fallback por fallo transitorio

// Lista permitida de códigos de estado HTTP válidos traducibles desde Apps Script
const ALLOWED_HTTP_STATUS_CODES = new Set([
  400, // Bad Request
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found
  405, // Method Not Allowed
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504  // Gateway Timeout
]);

/**
 * CLASIFICACIÓN ESTRUCTURADA DE ERRORES:
 * Define de forma unívoca qué errores son transitorios (elegibles para fallback a caché si no superan 5 min)
 * y cuáles son no transitorios (formato, JSON, configuración, redirección rechazada, 401/403 de Apps Script),
 * los cuales NUNCA deben enmascararse tras una caché existente.
 */
const ERROR_CATEGORIES = {
  TRANSIENT_NETWORK: 'TRANSIENT_NETWORK',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_FORMAT: 'INVALID_FORMAT',
  CONFIG_ERROR: 'CONFIG_ERROR',
  REDIRECTION_REJECTED: 'REDIRECTION_REJECTED',
  APPS_SCRIPT_EXPLICIT: 'APPS_SCRIPT_EXPLICIT',
  UPSTREAM_HTTP_ERROR: 'UPSTREAM_HTTP_ERROR'
};

const TRANSIENT_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ESOCKETTIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN'
]);

class RankingError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RankingError';
    this.category = options.category || ERROR_CATEGORIES.CONFIG_ERROR;
    this.isTransient = options.isTransient === true;
    this.httpStatus = options.httpStatus || 502;
    if (options.code) this.code = options.code;
  }
}

function classifyRankingError(err) {
  if (!err) {
    return {
      category: ERROR_CATEGORIES.CONFIG_ERROR,
      isTransient: false,
      httpStatus: 502,
      code: 502,
      message: "Error desconocido"
    };
  }

  if (err instanceof RankingError || (typeof err === 'object' && err.category && typeof err.isTransient === 'boolean')) {
    return {
      category: err.category,
      isTransient: err.isTransient === true,
      httpStatus: err.httpStatus || 502,
      code: err.code || err.httpStatus || 502,
      message: err.message
    };
  }

  const msg = err.message || '';
  const codeStr = err.code || '';

  // 1. Error explícito devuelto por Apps Script
  if (msg.startsWith('APPS_SCRIPT_ERROR:')) {
    const parts = msg.split(':');
    const rawCode = parseInt(parts[1], 10);
    const validCode = ALLOWED_HTTP_STATUS_CODES.has(rawCode) ? rawCode : 502;
    const cleanMsg = parts.slice(2).join(':');
    return {
      category: ERROR_CATEGORIES.APPS_SCRIPT_EXPLICIT,
      isTransient: false,
      httpStatus: validCode,
      code: validCode,
      message: cleanMsg
    };
  }

  // 2. Errores de formato de esquema
  if (msg.includes('Formato de respuesta de ranking no válido')) {
    return {
      category: ERROR_CATEGORIES.INVALID_FORMAT,
      isTransient: false,
      httpStatus: 502,
      code: 502,
      message: msg
    };
  }

  // 3. Errores de JSON inválido
  if (msg.includes('JSON') || msg.includes('Error parseando respuesta JSON')) {
    return {
      category: ERROR_CATEGORIES.INVALID_JSON,
      isTransient: false,
      httpStatus: 502,
      code: 502,
      message: msg
    };
  }

  // 4. Redirecciones rechazadas o malformadas
  if (
    msg.includes('redirección') ||
    msg.includes('redirecciones') ||
    msg.includes('Protocolo de redirección inseguro') ||
    msg.includes('Destino de redirección no verificado')
  ) {
    return {
      category: ERROR_CATEGORIES.REDIRECTION_REJECTED,
      isTransient: false,
      httpStatus: 502,
      code: 502,
      message: msg
    };
  }

  // 5. Configuración incompleta
  if (msg.includes('Configuración incompleta')) {
    return {
      category: ERROR_CATEGORIES.CONFIG_ERROR,
      isTransient: false,
      httpStatus: 503,
      code: 503,
      message: msg
    };
  }

  // 6. Errores transitorios de red / socket / timeout identificados explícitamente
  const isTransientCode = TRANSIENT_NETWORK_CODES.has(codeStr);
  const isTransientMsg = msg.includes('Timeout') ||
                         msg.includes('timeout') ||
                         msg.includes('socket hang up') ||
                         msg.includes('ETIMEDOUT') ||
                         msg.includes('ECONNRESET') ||
                         msg.includes('ECONNREFUSED') ||
                         msg.includes('ENOTFOUND');

  if (isTransientCode || isTransientMsg) {
    return {
      category: ERROR_CATEGORIES.TRANSIENT_NETWORK,
      isTransient: true,
      httpStatus: 502,
      code: 502,
      message: msg
    };
  }

  // Fallback seguro: cualquier otro error se clasifica como no transitorio
  return {
    category: ERROR_CATEGORIES.CONFIG_ERROR,
    isTransient: false,
    httpStatus: 502,
    code: 502,
    message: msg
  };
}

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
      return callback(new RankingError("Demasiadas redirecciones de Google Apps Script", {
        category: ERROR_CATEGORIES.REDIRECTION_REJECTED,
        isTransient: false,
        httpStatus: 502
      }));
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
            return callback(new RankingError("URL de redirección malformada: " + urlErr.message, {
              category: ERROR_CATEGORIES.REDIRECTION_REJECTED,
              isTransient: false,
              httpStatus: 502
            }));
          }

          // Validación estricta del protocolo
          if (redirectUrl.protocol !== 'https:') {
            return callback(new RankingError("Protocolo de redirección inseguro: se requiere HTTPS", {
              category: ERROR_CATEGORIES.REDIRECTION_REJECTED,
              isTransient: false,
              httpStatus: 502
            }));
          }

          // Verificación de destino confiable (Allowlist estricta de dominios de ejecución de Google)
          const host = redirectUrl.hostname.toLowerCase();
          const isAllowedGoogleHost = host === 'script.googleusercontent.com' ||
                                     host.endsWith('.googleusercontent.com') ||
                                     host === 'script.google.com';

          if (!isAllowedGoogleHost) {
            return callback(new RankingError(`Destino de redirección no verificado o no confiable: ${host}. Abortando para proteger la integridad.`, {
              category: ERROR_CATEGORIES.REDIRECTION_REJECTED,
              isTransient: false,
              httpStatus: 502
            }));
          }

          // Google Apps Script exige leer el resultado del doPost mediante GET en script.googleusercontent.com
          // SEGURIDAD: Se invoca estrictamente con GET, body = null y sin reenviar secretos ni cabeceras sensibles
          return executeRequest(redirectUrl.href, 'GET', null, redirectCount + 1);
        }

        if (statusCode !== 200) {
          return callback(new RankingError(`Google Apps Script respondió con código HTTP ${statusCode}`, {
            category: ERROR_CATEGORIES.UPSTREAM_HTTP_ERROR,
            isTransient: false,
            httpStatus: 502
          }));
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
              return callback(new RankingError(`APPS_SCRIPT_ERROR:${code}:${msg}`, {
                category: ERROR_CATEGORIES.APPS_SCRIPT_EXPLICIT,
                isTransient: false,
                httpStatus: ALLOWED_HTTP_STATUS_CODES.has(code) ? code : 502,
                code: code
              }));
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
            return callback(new RankingError("Formato de respuesta de ranking no válido", {
              category: ERROR_CATEGORIES.INVALID_FORMAT,
              isTransient: false,
              httpStatus: 502
            }));
          } catch (e) {
            return callback(new RankingError("Error parseando respuesta JSON de Google Apps Script: " + e.message, {
              category: ERROR_CATEGORIES.INVALID_JSON,
              isTransient: false,
              httpStatus: 502
            }));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        callback(new RankingError("Timeout al conectar con Google Apps Script", {
          category: ERROR_CATEGORIES.TRANSIENT_NETWORK,
          isTransient: true,
          httpStatus: 502,
          code: 'ETIMEDOUT'
        }));
      });

      req.on('error', (err) => {
        const classified = classifyRankingError(err);
        callback(new RankingError(err.message, {
          category: classified.category,
          isTransient: classified.isTransient,
          httpStatus: classified.httpStatus,
          code: err.code
        }));
      });

      if (method === 'POST' && body) {
        req.write(body);
      }
      req.end();
    } catch (err) {
      const classified = classifyRankingError(err);
      callback(new RankingError(err.message, {
        category: classified.category,
        isTransient: classified.isTransient,
        httpStatus: classified.httpStatus,
        code: err.code
      }));
    }
  }

  executeRequest(targetUrl, 'POST', postData, 0);
}

let verifySupabaseTokenImpl = verifySupabaseToken;
let fetchUserProfileImpl = fetchUserProfile;
let fetchPrivateRankingImpl = fetchPrivateRanking;

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
  verifySupabaseTokenImpl(token, (authErr, user) => {
    if (authErr || !user) {
      return res.status(401).json({
        success: false,
        error: "Sesión inválida o expirada. Por favor, inicia sesión de nuevo."
      });
    }

    // 4. Consulta de la fuente de verdad en servidor: agentes_perfiles
    fetchUserProfileImpl(token, user, (profileErr, profile) => {
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
      fetchPrivateRankingImpl(RANKING_APPS_SCRIPT_URL, RANKING_SHARED_SECRET, (err, rankingData) => {
        if (err) {
          const classified = classifyRankingError(err);
          const cacheAge = now - memoryCache.timestamp;

          // 1. FALLBACK DE CACHÉ LIMITADO ESTRICTAMENTE A FALLOS TRANSITORIOS IDENTIFICADOS EXPLÍCITAMENTE
          // Errores de formato, JSON, configuración, redirección rechazada o explícitos de Apps Script
          // NUNCA hacen fallback a caché y devuelven inmediatamente su código de error correspondiente,
          // incluso si existe una caché reciente en memoria interna del servidor.
          if (classified.isTransient && !isForce && memoryCache.data && cacheAge <= MAX_STALE_CACHE_MS) {
            res.setHeader('X-Cache-Status', 'STALE');
            res.setHeader('X-Cache-Fallback', 'true');
            res.setHeader('X-Cache-Age-Seconds', Math.round(cacheAge / 1000).toString());
            res.setHeader('Warning', '110 - "Response is Stale: upstream connection failure"');
            return res.status(200).json(memoryCache.data);
          }

          // 2. Si no es un fallo transitorio o la caché no es válida/caducó (> MAX_STALE_CACHE_MS):
          // Se detiene la operación y se responde con el código de error correspondiente validado.
          const httpCode = classified.httpStatus;
          return res.status(httpCode).json({
            success: false,
            code: httpCode,
            error: classified.message,
            category: classified.category,
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
module.exports.ALLOWED_HTTP_STATUS_CODES = ALLOWED_HTTP_STATUS_CODES;
module.exports.ERROR_CATEGORIES = ERROR_CATEGORIES;
module.exports.RankingError = RankingError;
module.exports.classifyRankingError = classifyRankingError;
module.exports.MAX_STALE_CACHE_MS = MAX_STALE_CACHE_MS;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports.getMemoryCache = () => memoryCache;
module.exports.setMemoryCache = (data, timestamp) => {
  memoryCache = {
    data: data,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now()
  };
};
module.exports.resetMemoryCache = () => {
  memoryCache = { data: null, timestamp: 0 };
};
module.exports._setVerifySupabaseTokenForTesting = (fn) => { verifySupabaseTokenImpl = fn || verifySupabaseToken; };
module.exports._setFetchUserProfileForTesting = (fn) => { fetchUserProfileImpl = fn || fetchUserProfile; };
module.exports._setFetchPrivateRankingForTesting = (fn) => { fetchPrivateRankingImpl = fn || fetchPrivateRanking; };


