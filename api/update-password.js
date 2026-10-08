// ============================================================================
// API: ACTUALIZACIÓN AUTORIZADA DE CONTRASEÑA Y DESBLOQUEO DE PERFIL
// Archivo: api/update-password.js
// ============================================================================

const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
let updateSupabaseAuthPasswordImpl = updateSupabaseAuthPassword;
let liftRestrictionInDatabaseImpl = liftRestrictionInDatabase;

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
            return callback(new Error("Error parseando usuario de Supabase Auth"));
          }
        } else {
          return callback(new Error(`Sesión inválida o expirada (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Tiempo de espera agotado al validar la sesión"));
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
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
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

function updateSupabaseAuthPassword(userId, newPassword, callback) {
  try {
    const authUrl = new URL(`/auth/v1/admin/users/${userId}`, SUPABASE_URL);
    const postData = JSON.stringify({ password: newPassword });
    
    const options = {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      timeout: 8000
    };

    const req = https.request(authUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return callback(null, true);
        } else {
          try {
            const errJson = JSON.parse(raw);
            return callback(new Error(errJson.msg || errJson.message || errJson.error_description || `HTTP ${res.statusCode}`));
          } catch (e) {
            return callback(new Error(`Error en actualización de Auth (HTTP ${res.statusCode})`));
          }
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout al actualizar contraseña en Supabase Auth"));
    });

    req.on('error', err => callback(err));
    req.write(postData);
    req.end();
  } catch (err) {
    return callback(err);
  }
}

function liftRestrictionInDatabase(userId, callback) {
  try {
    const patchUrl = new URL(`/rest/v1/agentes_perfiles?user_id=eq.${userId}`, SUPABASE_URL);
    const postData = JSON.stringify({
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const options = {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      timeout: 8000
    };

    const req = https.request(patchUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const rows = JSON.parse(raw);
            if (!Array.isArray(rows) || rows.length === 0) {
              return callback(new Error("Respuesta vacía de la base de datos al actualizar perfil"));
            }
            const updatedProfile = rows[0];
            if (updatedProfile.must_change_password !== false) {
              return callback(new Error("El estado must_change_password no se actualizó a false en BD"));
            }
            return callback(null, updatedProfile);
          } catch (e) {
            return callback(new Error("Error parseando respuesta de actualización de perfil"));
          }
        } else {
          return callback(new Error(`Error al actualizar agentes_perfiles (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout al actualizar agentes_perfiles"));
    });

    req.on('error', err => callback(err));
    req.write(postData);
    req.end();
  } catch (err) {
    return callback(err);
  }
}

module.exports = function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: "Método no permitido. Utiliza POST." });
  }

  // 1. Verificación explícita de configuración del servidor
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 503, {
      success: false,
      error: "Configuración incompleta: Se requiere definir SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en el servidor."
    });
  }

  // 2. Verificación de cabecera Authorization Bearer
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendJson(res, 401, {
      success: false,
      error: "Acceso no autorizado: Se requiere token Bearer de sesión válido."
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return sendJson(res, 401, { success: false, error: "Token de sesión vacío." });
  }

  // 3. Procesamiento seguro del cuerpo de la petición (Maneja req.body pre-parseado o stream con límite)
  function processPayload(payload) {
    const { newPassword } = payload || {};
    
    // Validación de presencia y tipo estricto SIN alterar silenciosamente con trim()
    if (typeof newPassword !== 'string' || newPassword.length === 0) {
      return sendJson(res, 400, { success: false, error: "Debe proporcionar el campo newPassword como cadena de texto." });
    }

    if (newPassword.length < 8) {
      return sendJson(res, 400, {
        success: false,
        error: "La nueva contraseña debe tener como mínimo 8 caracteres."
      });
    }

    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return sendJson(res, 400, {
        success: false,
        error: "La nueva contraseña debe contener al menos una letra y un número."
      });
    }

    // 4. Autenticar identidad del usuario con Supabase Auth
    verifySupabaseTokenImpl(token, (authErr, user) => {
      if (authErr || !user || !user.id) {
        return sendJson(res, 401, {
          success: false,
          error: "Sesión inválida o expirada. Inicie sesión de nuevo.",
          details: authErr ? authErr.message : "Usuario no encontrado"
        });
      }

      const userId = user.id;

      // 5. Comprobar perfil y estado activo en la base de datos ANTES de efectuar cambios
      fetchUserProfileImpl(userId, (profileErr, profile) => {
        if (profileErr || !profile) {
          return sendJson(res, 403, {
            success: false,
            error: "Acceso denegado: Perfil de usuario no encontrado o no autorizado.",
            details: profileErr ? profileErr.message : null
          });
        }

        if (profile.activo === false) {
          return sendJson(res, 403, {
            success: false,
            error: "Cuenta desactivada por la gerencia. No se permite actualizar la contraseña."
          });
        }

        if (profile.dni && newPassword === profile.dni) {
          return sendJson(res, 400, {
            success: false,
            error: "La nueva contraseña no puede ser idéntica a tu número de DNI."
          });
        }

        // 6. Actualizar la contraseña en Supabase Auth con Service Role Key
        updateSupabaseAuthPasswordImpl(userId, newPassword, (updateErr) => {
          if (updateErr) {
            return sendJson(res, 400, {
              success: false,
              error: `No se pudo actualizar la contraseña en el servicio de identidad: ${updateErr.message}`
            });
          }

          // 7. SOLO TRAS CONFIRMAR que Auth actualizó la contraseña, levantar la restricción en la base de datos
          liftRestrictionInDatabaseImpl(userId, (dbErr, updatedProfile) => {
            if (dbErr || !updatedProfile) {
              // Contemplar fallo posterior en base de datos sin declarar éxito
              console.error(`[CRÍTICO] Contraseña actualizada en Auth para user_id=${userId} pero falló desbloqueo en BD:`, dbErr);
              return sendJson(res, 500, {
                success: false,
                error: "La contraseña se actualizó en el servicio de autenticación, pero ocurrió un error al sincronizar el estado en la base de datos. Contacte con gerencia para asistencia.",
                code: "PASSWORD_UPDATED_DB_SYNC_FAILED",
                details: dbErr ? dbErr.message : "Respuesta vacía en base de datos"
              });
            }

            // 8. Éxito confirmado y verificado
            return sendJson(res, 200, {
              success: true,
              message: "Contraseña actualizada exitosamente y restricción de primer acceso levantada.",
              profile: {
                dni: updatedProfile.dni,
                rol: updatedProfile.rol,
                mustChangePassword: updatedProfile.must_change_password
              }
            });
          });
        });
      });
    });
  }

  if (req.body && typeof req.body === 'object') {
    return processPayload(req.body);
  }

  let body = '';
  let byteCount = 0;
  const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB límite de seguridad

  req.on('data', chunk => {
    byteCount += chunk.length;
    if (byteCount > MAX_PAYLOAD_BYTES) {
      req.destroy();
      return sendJson(res, 413, { success: false, error: "Cuerpo de la petición demasiado grande (máximo 10 KB)." });
    }
    body += chunk;
  });

  req.on('end', () => {
    if (res.headersSent) return;
    try {
      const payload = body ? JSON.parse(body) : {};
      processPayload(payload);
    } catch (e) {
      return sendJson(res, 400, { success: false, error: "Cuerpo JSON inválido." });
    }
  });

  req.on('error', (err) => {
    if (res.headersSent) return;
    return sendJson(res, 500, { success: false, error: "Error en el flujo de entrada de la petición." });
  });
};

module.exports._setVerifySupabaseTokenForTesting = (fn) => { verifySupabaseTokenImpl = fn || verifySupabaseToken; };
module.exports._setFetchUserProfileForTesting = (fn) => { fetchUserProfileImpl = fn || fetchUserProfile; };
module.exports._setUpdateSupabaseAuthPasswordForTesting = (fn) => { updateSupabaseAuthPasswordImpl = fn || updateSupabaseAuthPassword; };
module.exports._setLiftRestrictionInDatabaseForTesting = (fn) => { liftRestrictionInDatabaseImpl = fn || liftRestrictionInDatabase; };

