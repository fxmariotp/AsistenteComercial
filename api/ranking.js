const https = require('https');

/**
 * ============================================================================
 * FASE 1: SEGURIDAD Y CONTROL DE ACCESO EN /api/ranking
 * ============================================================================
 * 
 * MEDIDAS DE SEGURIDAD IMPLEMENTADAS:
 * 1. Verificación obligatoria de token JWT de Supabase Auth en servidor.
 * 2. Scoping por rol:
 *    - 'gerente' y 'comercial': Acceso permitido al ranking de puntos del equipo.
 *    - 'evaria': Denegado (HTTP 403 Forbidden).
 *    - Peticiones anónimas o sin sesión: Denegado (HTTP 401 Unauthorized).
 * 3. Cabeceras anti-caché estrictas (private, no-cache, no-store).
 * 
 * NOTA SOBRE LA FUENTE DE ORIGEN (Google Apps Script):
 * El endpoint de Google Apps Script (script.google.com/macros/s/.../exec) sigue
 * siendo accesible públicamente si alguien conoce la URL directa. Para mitigar
 * este riesgo en origen, la dirección debe restringir la ejecución del script a
 * cuentas autorizadas de Google Workspace o mediante un token secreto de webhook.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bxgdtdzlijeaetlekbub.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_DlLT2Rz1npEXSuxpM9__tQ_WF-Q0-Ap";

let memoryCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 30 * 1000; // 30s de caché fresca en memoria interna del servidor

const KNOWN_GERENTES = ["MIGUELR"];
const KNOWN_EVARIA = ["MARIAC", "28750523V"];

function verifySupabaseToken(token, callback) {
  // Soporte para entornos de prueba locales controlados
  if (process.env.NODE_ENV === 'test' && token.startsWith('TEST_MOCK_TOKEN_')) {
    const parts = token.split('_');
    const mockRole = parts[3] || 'comercial';
    const mockDni = parts[4] || '47269867Z';
    return callback(null, {
      id: 'mock-uuid-' + mockDni,
      email: `${mockDni.toLowerCase()}@asistente.internal`,
      user_metadata: { dni: mockDni, rol: mockRole, status: 'active' },
      app_metadata: { role: mockRole }
    });
  }

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

function extractUserClaims(user) {
  let dni = '';
  if (user.user_metadata && user.user_metadata.dni) {
    dni = user.user_metadata.dni.trim().toUpperCase();
  } else if (user.app_metadata && user.app_metadata.dni) {
    dni = user.app_metadata.dni.trim().toUpperCase();
  } else if (user.email) {
    const emailParts = user.email.split('@');
    if (emailParts.length === 2 && emailParts[1] === 'asistente.internal') {
      dni = emailParts[0].toUpperCase();
    }
  }

  let rol = 'comercial';
  if (user.app_metadata && user.app_metadata.role) {
    rol = user.app_metadata.role.toLowerCase();
  } else if (user.user_metadata && user.user_metadata.rol) {
    rol = user.user_metadata.rol.toLowerCase();
  } else if (KNOWN_GERENTES.includes(dni)) {
    rol = 'gerente';
  } else if (KNOWN_EVARIA.includes(dni)) {
    rol = 'evaria';
  }

  let status = 'active';
  if (user.user_metadata && user.user_metadata.status) {
    status = user.user_metadata.status.toLowerCase();
  } else if (user.app_metadata && user.app_metadata.status) {
    status = user.app_metadata.status.toLowerCase();
  }

  return { dni, rol, status, id: user.id };
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

  // 1. Verificación obligatoria de cabecera Authorization
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
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

  // 2. Validación de token con Supabase Auth
  verifySupabaseToken(token, (authErr, user) => {
    if (authErr || !user) {
      return res.status(401).json({
        success: false,
        error: "Sesión inválida o expirada. Por favor, inicia sesión de nuevo."
      });
    }

    const claims = extractUserClaims(user);

    // 3. Comprobación de usuario inactivo
    if (claims.status === 'inactive') {
      return res.status(403).json({
        success: false,
        error: "Cuenta desactivada por gerencia."
      });
    }

    // 4. Scoping por rol: Evaria denegado
    if (claims.rol === 'evaria') {
      return res.status(403).json({
        success: false,
        error: "Acceso denegado: El perfil Evaria no tiene acceso al módulo de ranking."
      });
    }

    // Roles permitidos: 'comercial' y 'gerente'
    if (claims.rol !== 'comercial' && claims.rol !== 'gerente') {
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

    const targetUrl = "https://script.google.com/macros/s/AKfycbzY2EB-cS_DciqXZ4Rfphu1sbyVs4SzVvEVKmkjeaKPoGXDD6UYc-31lNv2K0ti6Bf_eg/exec?json=true";
    let isResolved = false;

    function fetchUrl(url, redirectCount = 0) {
      if (redirectCount > 5) {
        if (memoryCache.data) {
          res.setHeader('X-Cache-Fallback', 'true');
          return res.status(200).json(memoryCache.data);
        }
        return res.status(500).json({ error: "Demasiadas redirecciones de Google Apps Script" });
      }

      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: 14000
      };

      const googleReq = https.get(url, requestOptions, (googleRes) => {
        const { statusCode } = googleRes;

        if (statusCode >= 300 && statusCode < 400 && googleRes.headers.location) {
          return fetchUrl(googleRes.headers.location, redirectCount + 1);
        }

        if (statusCode !== 200) {
          if (memoryCache.data) {
            res.setHeader('X-Cache-Fallback', 'true');
            return res.status(200).json(memoryCache.data);
          }
          return res.status(statusCode).json({ error: `Google Script respondió con código ${statusCode}` });
        }

        let rawData = '';
        googleRes.on('data', (chunk) => { rawData += chunk; });
        googleRes.on('end', () => {
          if (isResolved) return;
          isResolved = true;
          try {
            const parsedData = JSON.parse(rawData);
            if (Array.isArray(parsedData) && parsedData.length > 0) {
              memoryCache.data = parsedData;
              memoryCache.timestamp = Date.now();
              res.setHeader('X-Cache-Status', 'MISS');
              return res.status(200).json(parsedData);
            } else {
              throw new Error("Formato de array no válido");
            }
          } catch (e) {
            if (memoryCache.data) {
              res.setHeader('X-Cache-Fallback', 'true');
              return res.status(200).json(memoryCache.data);
            }
            return res.status(500).json({ error: "Error parseando respuesta de Google Script" });
          }
        });
      });

      googleReq.on('timeout', () => {
        googleReq.destroy();
        if (isResolved) return;
        isResolved = true;
        if (memoryCache.data) {
          res.setHeader('X-Cache-Fallback', 'true');
          return res.status(200).json(memoryCache.data);
        }
        return res.status(504).json({ error: "Tiempo de espera agotado con Google Apps Script" });
      });

      googleReq.on('error', (e) => {
        if (isResolved) return;
        isResolved = true;
        if (memoryCache.data) {
          res.setHeader('X-Cache-Fallback', 'true');
          return res.status(200).json(memoryCache.data);
        }
        return res.status(500).json({ error: e.message });
      });
    }

    fetchUrl(targetUrl);
  });
};
