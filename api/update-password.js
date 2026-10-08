// ============================================================================
// API: ACTUALIZACIÓN AUTORIZADA DE CONTRASEÑA Y DESBLOQUEO DE PERFIL
// Archivo: api/update-password.js
// ============================================================================

const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bxgdtdzlijeaetlekbub.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_DlLT2Rz1npEXSuxpM9__tQ_WF-Q0-Ap";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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
            return callback(new Error("Error parseando usuario de Supabase"));
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

function updateSupabasePassword(token, userId, newPassword, callback) {
  try {
    // Si disponemos de Service Role Key usamos la API Admin, de lo contrario PUT /auth/v1/user con el token del usuario
    const useAdmin = Boolean(SUPABASE_SERVICE_ROLE_KEY);
    const endpoint = useAdmin ? `/auth/v1/admin/users/${userId}` : '/auth/v1/user';
    const authUrl = new URL(endpoint, SUPABASE_URL);
    
    const postData = JSON.stringify({ password: newPassword });
    const options = {
      method: useAdmin ? 'PUT' : 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': useAdmin ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${useAdmin ? SUPABASE_SERVICE_ROLE_KEY : token}`
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
            return callback(new Error(`Fallo en actualización de contraseña (HTTP ${res.statusCode})`));
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

function liftRestrictionInDatabase(token, userId, callback) {
  try {
    const useAdmin = Boolean(SUPABASE_SERVICE_ROLE_KEY);
    const patchUrl = new URL(`/rest/v1/agentes_perfiles?user_id=eq.${userId}`, SUPABASE_URL);
    const postData = JSON.stringify({
      must_change_password: false,
      password_changed_at: new Date().toISOString()
    });

    const options = {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': useAdmin ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${useAdmin ? SUPABASE_SERVICE_ROLE_KEY : token}`,
        'Prefer': 'return=representation'
      },
      timeout: 8000
    };

    const req = https.request(patchUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return callback(null, true);
        } else {
          return callback(new Error(`Error al levantar restricción en BD (HTTP ${res.statusCode})`));
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
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Método no permitido. Utiliza POST." });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: "Acceso no autorizado: Se requiere token Bearer verificable."
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ success: false, error: "Token de sesión vacío." });
  }

  // Leer cuerpo de la petición
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let payload = {};
    try {
      if (body) payload = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ success: false, error: "Cuerpo JSON inválido." });
    }

    const { newPassword } = payload;
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, error: "Debe proporcionar el campo newPassword." });
    }

    const trimmedPassword = newPassword.trim();
    if (trimmedPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: "La nueva contraseña debe tener como mínimo 8 caracteres."
      });
    }

    if (!/[A-Za-z]/.test(trimmedPassword) || !/[0-9]/.test(trimmedPassword)) {
      return res.status(400).json({
        success: false,
        error: "La nueva contraseña debe contener al menos una letra y un número."
      });
    }

    // 1. Verificar identidad del usuario en Supabase Auth
    verifySupabaseToken(token, (authErr, user) => {
      if (authErr || !user) {
        return res.status(401).json({
          success: false,
          error: "Sesión no válida o expirada.",
          details: authErr ? authErr.message : "Usuario no encontrado"
        });
      }

      // 2. Ejecutar actualización de contraseña en Supabase Auth
      updateSupabasePassword(token, user.id, trimmedPassword, (updateErr) => {
        if (updateErr) {
          return res.status(400).json({
            success: false,
            error: `No se pudo actualizar la contraseña: ${updateErr.message}`
          });
        }

        // 3. SOLO TRAS CONFIRMAR que Supabase Auth actualizó la contraseña, levantar la restricción en la base de datos
        liftRestrictionInDatabase(token, user.id, (dbErr) => {
          if (dbErr) {
            return res.status(500).json({
              success: false,
              error: `Contraseña actualizada en Auth pero falló el registro en base de datos: ${dbErr.message}`
            });
          }

          return res.status(200).json({
            success: true,
            message: "Contraseña actualizada exitosamente. Restricción de primer acceso levantada."
          });
        });
      });
    });
  });
};
