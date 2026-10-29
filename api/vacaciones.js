// ============================================================================
// API: GESTIÓN AUTORIZADA DE VACACIONES (INSERT / DELETE / BULK_ADD)
// Archivo: api/vacaciones.js
// ============================================================================
// Permite a comerciales gestionar sus propias vacaciones (hasta 26 días laborables)
// y a gerentes gestionar las vacaciones de cualquier comercial de la plantilla.
// REGLAS DE SEGURIDAD:
// 1. Exige token Bearer de sesión válido verificado con Supabase Auth.
// 2. Comprueba perfil autoritativo en agentes_perfiles (activo = true).
// 3. Comerciales solo pueden modificar su propio DNI (profile.dni === dni).
// 4. Gerentes pueden modificar cualquier DNI (profile.rol === 'gerente').
// 5. Evaria y perfiles inactivos son denegados con HTTP 403 Forbidden.
// 6. Aplica la regla estricta de cupo anual máximo: 26 días laborables.
// ============================================================================

const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PROD_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.PROD_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || "";

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(statusCode).json(payload);
}

let verifySupabaseTokenImpl = verifySupabaseToken;
let fetchUserProfileImpl = fetchUserProfile;
let executeVacacionesOpImpl = executeVacacionesOp;
let getVacationCountImpl = getVacationCount;

function getAdminHeaders(extraHeaders = {}) {
  const isJwt = typeof SUPABASE_SERVICE_ROLE_KEY === 'string' && SUPABASE_SERVICE_ROLE_KEY.startsWith('ey');
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    ...extraHeaders
  };
  if (isJwt) {
    headers['Authorization'] = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return headers;
}

function verifySupabaseToken(token, callback) {
  try {
    const authUrl = new URL('/auth/v1/user', SUPABASE_URL);
    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY
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
            return callback(new Error("Error parseando usuario de Supabase Auth"));
          }
        }
        return callback(new Error(`Sesión inválida o expirada (HTTP ${res.statusCode})`));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout verificando sesión en Supabase"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

function fetchUserProfile(userId, callback) {
  try {
    const profileUrl = new URL(`/rest/v1/agentes_perfiles?user_id=eq.${userId}&select=id,dni,nombre,rol,activo,must_change_password`, SUPABASE_URL);
    const options = {
      headers: getAdminHeaders(),
      timeout: 8000
    };

    const req = https.get(profileUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const rows = JSON.parse(raw);
            if (Array.isArray(rows) && rows.length > 0) {
              return callback(null, rows[0]);
            }
            return callback(new Error("Perfil no encontrado en public.agentes_perfiles"));
          } catch (e) {
            return callback(new Error("Error parseando respuesta de perfil"));
          }
        }
        return callback(new Error(`Error consultando perfil en BD (HTTP ${res.statusCode})`));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout al consultar perfil en BD"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

function getVacationCount(dni, callback) {
  try {
    const url = new URL(`/rest/v1/vacaciones?dni=eq.${encodeURIComponent(dni)}&select=fecha`, SUPABASE_URL);
    const options = {
      headers: getAdminHeaders(),
      timeout: 8000
    };

    const req = https.get(url, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const rows = JSON.parse(raw);
            return callback(null, rows);
          } catch (e) {
            return callback(new Error("Error parseando vacaciones"));
          }
        }
        return callback(new Error(`Error al contar vacaciones (HTTP ${res.statusCode})`));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout al consultar vacaciones"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

function executeVacacionesOp(op, callback) {
  try {
    const { action, dni, fecha, fechas } = op;

    if (action === 'delete') {
      const delUrl = new URL(`/rest/v1/vacaciones?dni=eq.${encodeURIComponent(dni)}&fecha=eq.${encodeURIComponent(fecha)}`, SUPABASE_URL);
      const options = {
        method: 'DELETE',
        headers: getAdminHeaders(),
        timeout: 8000
      };

      const req = https.request(delUrl, options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return callback(null, { success: true, action: 'delete', dni, fecha });
          }
          return callback(new Error(`Error al eliminar vacación en BD (HTTP ${res.statusCode})`));
        });
      });

      req.on('timeout', () => {
        req.destroy();
        return callback(new Error("Timeout al eliminar vacación en BD"));
      });

      req.on('error', err => callback(err));
      req.end();
      return;
    }

    if (action === 'add') {
      const addUrl = new URL('/rest/v1/vacaciones', SUPABASE_URL);
      const postData = JSON.stringify({ dni, fecha });
      const options = {
        method: 'POST',
        headers: getAdminHeaders({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Prefer': 'return=representation'
        }),
        timeout: 8000
      };

      const req = https.request(addUrl, options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return callback(null, { success: true, action: 'add', dni, fecha });
          }
          // Si ya existe (código 409 o mensaje de duplicado), considerarlo éxito idempotente
          if (res.statusCode === 409 || (raw && raw.includes('duplicate key'))) {
            return callback(null, { success: true, action: 'add', dni, fecha, duplicate: true });
          }
          return callback(new Error(`Error al insertar vacación en BD (HTTP ${res.statusCode}): ${raw}`));
        });
      });

      req.on('timeout', () => {
        req.destroy();
        return callback(new Error("Timeout al insertar vacación en BD"));
      });

      req.on('error', err => callback(err));
      req.write(postData);
      req.end();
      return;
    }

    if (action === 'bulk_add') {
      if (!Array.isArray(fechas) || fechas.length === 0) {
        return callback(null, { success: true, action: 'bulk_add', count: 0 });
      }

      const rows = fechas.map(f => ({ dni, fecha: f }));
      const bulkUrl = new URL('/rest/v1/vacaciones', SUPABASE_URL);
      const postData = JSON.stringify(rows);
      const options = {
        method: 'POST',
        headers: getAdminHeaders({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Prefer': 'resolution=ignore-duplicates'
        }),
        timeout: 8000
      };

      const req = https.request(bulkUrl, options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return callback(null, { success: true, action: 'bulk_add', count: rows.length });
          }
          return callback(new Error(`Error en inserción múltiple de vacaciones (HTTP ${res.statusCode}): ${raw}`));
        });
      });

      req.on('timeout', () => {
        req.destroy();
        return callback(new Error("Timeout en inserción múltiple de vacaciones"));
      });

      req.on('error', err => callback(err));
      req.write(postData);
      req.end();
      return;
    }

    return callback(new Error(`Acción desconocida: ${action}`));
  } catch (err) {
    return callback(err);
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: "Método no permitido. Utiliza POST." });
  }

  // 1. Verificación de configuración de entorno
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 503, {
      success: false,
      error: "Servicio no disponible: Configuración administrativa de Supabase no definida."
    });
  }

  // 2. Extraer Bearer Token
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return sendJson(res, 401, {
      success: false,
      error: "Acceso no autorizado: Se requiere token Bearer de sesión válido."
    });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return sendJson(res, 401, {
      success: false,
      error: "Acceso no autorizado: Token de sesión vacío."
    });
  }

  // 3. Validar token con Supabase Auth
  verifySupabaseTokenImpl(token, (tokenErr, authUser) => {
    if (tokenErr || !authUser || !authUser.id) {
      return sendJson(res, 401, {
        success: false,
        error: "Sesión no válida o expirada. Por favor, recarga la página o inicia sesión de nuevo."
      });
    }

    // 4. Consultar perfil autoritativo en agentes_perfiles
    fetchUserProfileImpl(authUser.id, (profileErr, profile) => {
      if (profileErr || !profile) {
        return sendJson(res, 403, {
          success: false,
          error: "Acceso denegado: Perfil de agente no encontrado."
        });
      }

      if (!profile.activo) {
        return sendJson(res, 403, {
          success: false,
          error: "Acceso denegado: Tu cuenta de agente se encuentra desactivada."
        });
      }

      // 5. Parsear payload de la petición
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const action = body.action;
      const targetDni = typeof body.dni === 'string' ? body.dni.trim().toUpperCase() : '';
      const fecha = typeof body.fecha === 'string' ? body.fecha.trim() : '';
      const fechas = Array.isArray(body.fechas) ? body.fechas.map(f => String(f).trim()) : [];

      if (!['add', 'delete', 'bulk_add'].includes(action)) {
        return sendJson(res, 400, {
          success: false,
          error: "Acción inválida. Acciones soportadas: 'add', 'delete', 'bulk_add'."
        });
      }

      if (!targetDni) {
        return sendJson(res, 400, {
          success: false,
          error: "DNI de agente obligatorio."
        });
      }

      // 6. Autorización según rol:
      // Gerente puede modificar cualquier comercial.
      // Comercial solo puede modificar sus propias vacaciones.
      const isGerente = profile.rol === 'gerente';
      const isOwnVacation = profile.dni === targetDni;

      if (!isGerente && !isOwnVacation) {
        return sendJson(res, 403, {
          success: false,
          error: "Acceso denegado: No tienes permisos para gestionar vacaciones de otro comercial."
        });
      }

      if (profile.rol === 'evaria' && !isGerente) {
        return sendJson(res, 403, {
          success: false,
          error: "Acceso denegado: Los usuarios de Evaria no tienen permisos de gestión de vacaciones."
        });
      }

      // 7. Validación de fechas
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if ((action === 'add' || action === 'delete') && !dateRegex.test(fecha)) {
        return sendJson(res, 400, {
          success: false,
          error: "Fecha inválida. Debe respetar el formato YYYY-MM-DD."
        });
      }

      // 8. Validación del cupo anual máximo (26 días laborables) para 'add' y 'bulk_add'
      if (action === 'add' || action === 'bulk_add') {
        getVacationCountImpl(targetDni, (countErr, existingRows) => {
          if (countErr) {
            return sendJson(res, 500, {
              success: false,
              error: "Error comprobando el cupo de vacaciones del agente."
            });
          }

          const existingDates = new Set((existingRows || []).map(r => r.fecha));

          if (action === 'add') {
            if (!existingDates.has(fecha) && existingDates.size >= 26) {
              return sendJson(res, 400, {
                success: false,
                error: "No se pueden superar los 26 días laborables de vacaciones anuales."
              });
            }
          } else if (action === 'bulk_add') {
            const combined = new Set([...existingDates, ...fechas]);
            if (combined.size > 26) {
              return sendJson(res, 400, {
                success: false,
                error: "La asignación masiva excede el cupo máximo de 26 días laborables de vacaciones."
              });
            }
          }

          // 9. Ejecutar operación
          executeVacacionesOpImpl({ action, dni: targetDni, fecha, fechas }, (opErr, opRes) => {
            if (opErr) {
              return sendJson(res, 500, {
                success: false,
                error: opErr.message || "Error al actualizar vacaciones en la nube."
              });
            }
            return sendJson(res, 200, opRes);
          });
        });
        return;
      }

      // Para 'delete'
      executeVacacionesOpImpl({ action, dni: targetDni, fecha }, (opErr, opRes) => {
        if (opErr) {
          return sendJson(res, 500, {
            success: false,
            error: opErr.message || "Error al eliminar vacación en la nube."
          });
        }
        return sendJson(res, 200, opRes);
      });
    });
  });
}

// Hooks para pruebas unitarias y de integración
handler._setVerifySupabaseTokenForTesting = (fn) => { verifySupabaseTokenImpl = fn; };
handler._setFetchUserProfileForTesting = (fn) => { fetchUserProfileImpl = fn; };
handler._setExecuteVacacionesOpForTesting = (fn) => { executeVacacionesOpImpl = fn; };
handler._setGetVacationCountForTesting = (fn) => { getVacationCountImpl = fn; };

module.exports = handler;
