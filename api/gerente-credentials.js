// ============================================================================
// API: CONSULTA AUTORIZADA DE CREDENCIALES PARA GERENCIA
// Archivo: api/gerente-credentials.js
// ============================================================================
// Permite a los usuarios con rol de Gerencia desocultar las contraseñas vigentes
// de los comerciales desde el panel de Gestión de Usuarios.
// REGLAS DE SEGURIDAD:
// 1. Exige token Bearer de sesión válido verificado con Supabase Auth.
// 2. Comprueba perfil autoritativo en agentes_perfiles (rol = 'gerente' y activo = true).
// 3. Deniega con HTTP 403 a comerciales, trabajadores de Evaria o usuarios inactivos.
// 4. Si el agente ya cambió su contraseña (must_change_password = false), reporta
//    "Contraseña personal ya establecida" protegiendo el hash bcrypt de Supabase Auth.
// 5. Si el agente aún no ha cambiado su contraseña (must_change_password = true),
//    entrega la contraseña temporal activa de agentes_credenciales_temp.
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
let fetchAllProfilesImpl = fetchAllProfiles;
let fetchTempCredentialsImpl = fetchTempCredentials;

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
            return callback(null, null);
          } catch (e) {
            return callback(new Error("Error procesando perfil de usuario"));
          }
        } else {
          return callback(new Error(`Error al consultar perfil (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Tiempo de espera agotado al consultar perfil"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

function fetchAllProfiles(callback) {
  try {
    const url = new URL('/rest/v1/agentes_perfiles?select=dni,nombre,rol,activo,must_change_password', SUPABASE_URL);
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
            return callback(new Error("Error parseando perfiles de agentes"));
          }
        } else {
          return callback(new Error(`Error consultando perfiles (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout consultando perfiles"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

function fetchTempCredentials(callback) {
  try {
    const url = new URL('/rest/v1/agentes_credenciales_temp?select=dni,temp_password', SUPABASE_URL);
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
            return callback(new Error("Error parseando credenciales temporales"));
          }
        } else {
          return callback(new Error(`Error consultando credenciales temporales (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      return callback(new Error("Timeout consultando credenciales temporales"));
    });

    req.on('error', err => callback(err));
  } catch (err) {
    return callback(err);
  }
}

module.exports = function (req, res) {
  // CORS seguro
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verificación de configuración del servidor
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 503, {
      success: false,
      error: "Servicio no disponible: Configuración administrativa incompleta en el servidor."
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

  // 3. Autenticar identidad del usuario con Supabase Auth
  verifySupabaseTokenImpl(token, (authErr, user) => {
    if (authErr || !user || !user.id) {
      return sendJson(res, 401, {
        success: false,
        error: "Sesión inválida o expirada. Inicie sesión de nuevo.",
        details: authErr ? authErr.message : "Usuario no encontrado"
      });
    }

    const userId = user.id;

    // 4. Comprobar perfil y verificar rol de gerente
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
          error: "Cuenta desactivada por la gerencia. Acceso denegado."
        });
      }

      if (profile.rol !== 'gerente') {
        return sendJson(res, 403, {
          success: false,
          error: "Acceso denegado: Se requieren permisos de Gerencia para desocultar credenciales."
        });
      }

      // 5. Cargar perfiles y credenciales temporales
      fetchAllProfilesImpl((pErr, profiles) => {
        if (pErr || !profiles) {
          return sendJson(res, 500, {
            success: false,
            error: "Error al consultar catálogo de agentes.",
            details: pErr ? pErr.message : null
          });
        }

        fetchTempCredentialsImpl((cErr, tempCreds) => {
          const tempMap = {};
          if (Array.isArray(tempCreds)) {
            tempCreds.forEach(c => {
              if (c.dni) tempMap[c.dni] = c.temp_password;
            });
          }

          const credentialsMap = {};
          profiles.forEach(agent => {
            const isPersonal = agent.must_change_password === false;
            const tempPass = tempMap[agent.dni] || null;

            credentialsMap[agent.dni] = {
              dni: agent.dni,
              nombre: agent.nombre,
              rol: agent.rol,
              mustChangePassword: agent.must_change_password === true,
              isPersonal: isPersonal,
              password: isPersonal ? "Contraseña personal ya establecida" : (tempPass || "••••••••"),
              statusLabel: isPersonal ? "Personal ya establecida" : "Temporal vigente"
            };
          });

          return sendJson(res, 200, {
            success: true,
            credentials: credentialsMap
          });
        });
      });
    });
  });
};

// Hooks para pruebas automatizadas (aislamiento de red)
module.exports._setVerifySupabaseTokenForTesting = function (fn) {
  verifySupabaseTokenImpl = fn;
};
module.exports._setFetchUserProfileForTesting = function (fn) {
  fetchUserProfileImpl = fn;
};
module.exports._setFetchAllProfilesForTesting = function (fn) {
  fetchAllProfilesImpl = fn;
};
module.exports._setFetchTempCredentialsForTesting = function (fn) {
  fetchTempCredentialsImpl = fn;
};
