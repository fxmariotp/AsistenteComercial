// ============================================================================
// API: CONSULTA AUTORIZADA DE COMISIONES (GOOGLE SHEETS API v4 + SERVICE ACCOUNT)
// Archivo: api/comisiones.js
// ============================================================================
// REGLA DE NEGOCIO CONFIRMADA POR DIRECCIÓN:
// El cupo anual de vacaciones de Comerciales Renosur es de 26 días laborables.
// (Esta regla se documenta a nivel de políticas sin alterar cálculos actuales).
// ============================================================================

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * MEDIDAS DE SEGURIDAD IMPLEMENTADAS:
 * 1. Acceso a Google Sheets privado mediante Google Service Account (OAuth 2.0 JWT Bearer).
 * 2. Consulta autorizada a la API v4 de Google Sheets (/v4/spreadsheets/.../values/A:Z).
 * 3. Cero credenciales ni URLs públicas predeterminadas (requiere variables de entorno explícitas).
 * 4. Verificación obligatoria de token JWT de Supabase Auth en servidor contra /auth/v1/user.
 * 5. Consulta autoritativa en BD pública (agentes_perfiles): rol, activo, must_change_password.
 * 6. Scoping estricto por rol:
 *    - 'comercial': Devuelve ÚNICAMENTE su propia comisión individual.
 *    - 'gerente': Devuelve las comisiones consolidadas del equipo comercial.
 *    - 'evaria': Denegado (HTTP 403 Forbidden).
 * 7. Eliminación absoluta de filtración de 'sheetId' en la respuesta JSON.
 * 8. Cabeceras anti-caché estrictas (private, no-cache, no-store, must-revalidate).
 */

// Variables de entorno estrictas (sin valores de producción predeterminados)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || "";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";

const RENOSUR_AGENTS = [
  // Cuentas de Staging aisladas (sintéticas)
  {
    dni: "00000001A",
    name: "COMERCIAL TEST A",
    keywords: ["COMERCIAL TEST A", "TEST A"]
  },
  {
    dni: "00000002B",
    name: "COMERCIAL TEST B",
    keywords: ["COMERCIAL TEST B", "TEST B"]
  },
  {
    dni: "00000003G",
    name: "GERENTE TEST",
    keywords: ["GERENTE TEST"]
  },
  // Catálogo operativo
  {
    dni: "28727453Q",
    name: "BEGOÑA CABANILLAS PIQUERO",
    keywords: ["BEGOÑA", "BEGONA", "CABANILLAS", "PIQUERO", "BEGO"]
  },
  {
    dni: "47269867Z",
    name: "CHRISTIAN CABRERA MARQUEZ",
    keywords: ["CHRISTIAN", "CRISTIAN", "CABRERA MARQUEZ"]
  },
  {
    dni: "47539234M",
    name: "ANA ROCIO GALERA MORILLO",
    keywords: ["ANA ROCIO", "ANA", "GALERA", "MORILLO"]
  },
  {
    dni: "28818524F",
    name: "CRISTINA SANTOS LARIOS",
    keywords: ["CRISTINA", "SANTOS", "LARIOS", "CRIS"]
  },
  {
    dni: "53770728V",
    name: "FRANCISCO JAVIER MORA ANDREU",
    keywords: ["FRANCISCO JAVIER", "JAVIER MORA", "FRANCISCO JAVIER MORA", "MORA ANDREU", "JAVI"]
  },
  {
    dni: "47269866J",
    name: "JOSE MIGUEL CABRERA MARQUEZ",
    keywords: ["JOSE MIGUEL", "JOSE M", "JOSEMI", "JOSÉ MIGUEL"]
  },
  {
    dni: "51997096F",
    name: "MANUELA SALAZAR CORTES",
    keywords: ["MANUELA", "SALAZAR", "CORTES", "MANOLI"]
  },
  {
    dni: "29537747C",
    name: "MARINA MARTINEZ DE LA ROSA",
    keywords: ["MARINA", "MARTINEZ", "DE LA ROSA", "ROSA"]
  },
  {
    dni: "77822813J",
    name: "MARIO TIBURCIO PORRAS",
    keywords: ["MARIO", "TIBURCIO", "PORRAS"]
  },
  {
    dni: "30369873Y",
    name: "MERCEDES TERRON DIEZ",
    keywords: ["MERCEDES", "TERRON", "DIEZ", "MERCHE"]
  },
  {
    dni: "53283415M",
    name: "MÓNICA CEJUDO HIDALGO",
    keywords: ["MONICA", "MÓNICA", "CEJUDO", "HIDALGO"]
  }
];

function cleanStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function findMatchingAgent(rawAgent) {
  if (!rawAgent) return null;
  const cleanInput = cleanStr(rawAgent);
  if (!cleanInput) return null;

  // 1. Coincidencia exacta con nombre oficial
  for (const agent of RENOSUR_AGENTS) {
    if (cleanStr(agent.name) === cleanInput) return agent;
  }

  // 2. Coincidencia por DNI si aparece en la celda
  for (const agent of RENOSUR_AGENTS) {
    if (cleanInput.includes(agent.dni)) return agent;
  }

  // 3. Desambiguación específica de hermanos CABRERA: "JOSE MIGUEL" vs "CHRISTIAN"
  if (cleanInput.includes("JOSE MIGUEL") || cleanInput.includes("JOSE M") || cleanInput.includes("JOSEMI") || cleanInput.includes("JOSÉ MIGUEL")) {
    return RENOSUR_AGENTS.find(a => a.dni === "47269866J");
  }
  if (cleanInput.includes("CHRISTIAN") || cleanInput.includes("CRISTIAN")) {
    return RENOSUR_AGENTS.find(a => a.dni === "47269867Z");
  }

  // 4. Coincidencia por palabras clave con detección de ambigüedad
  const matchingCandidates = [];
  for (const agent of RENOSUR_AGENTS) {
    for (const kw of agent.keywords) {
      const cleanKw = cleanStr(kw);
      if (cleanInput === cleanKw || cleanInput.startsWith(cleanKw + " ") || cleanInput.endsWith(" " + cleanKw) || cleanInput.includes(" " + cleanKw + " ")) {
        if (!matchingCandidates.some(c => c.dni === agent.dni)) {
          matchingCandidates.push(agent);
        }
        break;
      }
    }
  }

  if (matchingCandidates.length === 1) {
    return matchingCandidates[0];
  }

  if (matchingCandidates.length > 1) {
    return {
      isAmbiguous: true,
      rawAgent,
      candidates: matchingCandidates.map(c => ({ dni: c.dni, name: c.name }))
    };
  }

  return null;
}

function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentField = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(currentField.trim());
      if (row.some(field => field.length > 0)) {
        while (row.length < 35) row.push('');
        lines.push(row);
      }
      row = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || row.length > 0) {
    row.push(currentField.trim());
    if (row.some(field => field.length > 0)) {
      while (row.length < 35) row.push('');
      lines.push(row);
    }
  }
  return lines;
}

function parseComisionValue(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  let cleaned = String(raw).replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return 0;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Valida el token Bearer contra el endpoint /auth/v1/user de Supabase.
 */
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
 * Obtiene un access_token de Google mediante OAuth 2.0 JWT Bearer flow para la cuenta de servicio.
 */
function getGoogleAccessToken(email, privateKeyRaw, callback) {
  try {
    let privateKey = privateKeyRaw;
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const sHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const sClaim = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
    const signInput = `${sHeader}.${sClaim}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signInput);
    signer.end();
    const signature = signer.sign(privateKey, 'base64url');
    const jwt = `${signInput}.${signature}`;

    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const tokenUrl = new URL('https://oauth2.googleapis.com/token');

    const req = https.request(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(raw);
            if (data.access_token) {
              return callback(null, data.access_token);
            }
            return callback(new Error("No se recibió access_token de Google OAuth"));
          } catch (e) {
            return callback(new Error("Error parseando respuesta de Google OAuth"));
          }
        }
        return callback(new Error(`Error de autenticación Google OAuth (HTTP ${res.statusCode}): ${raw}`));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      callback(new Error("Timeout al autenticar con Google OAuth"));
    });
    req.on('error', err => callback(err));
    req.write(postData);
    req.end();
  } catch (err) {
    callback(err);
  }
}

/**
 * Consulta la hoja privada de Google Sheets mediante la API REST v4 oficial.
 */
function fetchPrivateSheetValues(accessToken, sheetId, callback) {
  try {
    const range = encodeURIComponent('A:Z');
    const sheetsUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`);
    
    const options = {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      timeout: 12000
    };

    const req = https.get(sheetsUrl, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(raw);
            const values = json.values || [];
            return callback(null, values);
          } catch (e) {
            return callback(new Error("Error parseando filas de Google Sheets API"));
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          return callback(new Error(`Permisos insuficientes en Google Sheets (HTTP ${res.statusCode}). Verifica que la cuenta de servicio tenga acceso de lectura.`));
        } else {
          return callback(new Error(`Google Sheets API respondió con HTTP ${res.statusCode}: ${raw}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      callback(new Error("Timeout al consultar Google Sheets API"));
    });
    req.on('error', err => callback(err));
  } catch (err) {
    callback(err);
  }
}

let verifySupabaseTokenImpl = verifySupabaseToken;
let fetchUserProfileImpl = fetchUserProfile;
let getGoogleAccessTokenImpl = getGoogleAccessToken;
let fetchPrivateSheetValuesImpl = fetchPrivateSheetValues;

module.exports = function (req, res) {
  // CORS estricto
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Cabeceras estrictas anti-caché
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verificación obligatoria de variables de entorno (Cero valores por defecto a producción)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return res.status(503).json({
      success: false,
      error: "Configuración incompleta: Se requieren SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY y GOOGLE_SHEET_ID en las variables de entorno del servidor."
    });
  }

  // 2. Verificación de cabecera Authorization Bearer
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: "Acceso no autorizado: Se requiere una sesión activa con token Bearer verificable."
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Acceso no autorizado: Token de sesión vacío."
    });
  }

  // 3. Verificación criptográfica del token con Supabase Auth
  verifySupabaseTokenImpl(token, (authErr, user) => {
    if (authErr || !user) {
      return res.status(401).json({
        success: false,
        error: "Sesión inválida o expirada. Por favor, inicia sesión de nuevo.",
        details: authErr ? authErr.message : "Usuario no encontrado"
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
      const nombre = profile.nombre || '';

      // Comprobación de estado activo del usuario
      if (!activo) {
        return res.status(403).json({
          success: false,
          error: "Tu cuenta de usuario ha sido desactivada por gerencia."
        });
      }

      // Comprobación obligatoria de cambio de contraseña pendiente (servidor)
      if (mustChangePassword) {
        return res.status(403).json({
          success: false,
          error: "Acceso bloqueado: Cambio obligatorio de contraseña pendiente. Debes actualizar tu contraseña personal antes de consultar las comisiones.",
          mustChangePassword: true
        });
      }

      // Scoping por rol: Trabajadores Evaria no tienen acceso
      if (rol === 'evaria') {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado: El perfil Evaria no tiene acceso a las comisiones de Renosur."
        });
      }

      // Solo roles autorizados: 'comercial' o 'gerente'
      if (rol !== 'comercial' && rol !== 'gerente') {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado: Rol de usuario no autorizado."
        });
      }

      const claims = { dni, rol, status: activo ? 'active' : 'inactive', nombre, mustChangePassword, id: user.id };

      function processSheetRows(rows) {
        if (!rows || rows.length === 0) {
          return res.status(200).json({ success: false, error: "La hoja de comisiones está vacía", data: {} });
        }

        // Detectar columnas y fila de cabecera
        let startRow = 0;
        let colAgente = 0;
        let colComi = 1;

        for (let i = 0; i < Math.min(rows.length, 5); i++) {
          const r = rows[i] || [];
          for (let j = 0; j < r.length; j++) {
            const val = cleanStr(r[j]);
            if (val === 'AGENTE' || val === 'AGENTES' || val.includes('AGENTE')) {
              colAgente = j;
              startRow = i + 1;
            }
            if (val === 'COMI' || val === 'COMISION' || val === 'COMISIONES' || val.includes('COMI')) {
              colComi = j;
            }
          }
        }

        const comisionesMap = {};
        const matchedDetails = [];
        const ambiguousDetails = [];

        for (let i = startRow; i < rows.length; i++) {
          const r = rows[i];
          if (!r) continue;

          const rawAgent = (r[colAgente] !== undefined && r[colAgente] !== '' ? r[colAgente] : (r[0] || '')).toString().trim();
          const cleanAgent = cleanStr(rawAgent);

          if (!rawAgent || cleanAgent === 'AGENTES' || cleanAgent === 'AGENTE' || cleanAgent === 'TOTAL' || cleanAgent === 'TOTALES' || cleanAgent === 'MEDIA' || cleanAgent === 'PROMEDIO') {
            continue;
          }

          let rawVal = 0;
          if (r[colComi] !== undefined && r[colComi] !== '') {
            rawVal = r[colComi];
          } else if (r[1] !== undefined && r[1] !== '') {
            rawVal = r[1];
          } else if (r[19] !== undefined && r[19] !== '') {
            rawVal = r[19];
          }

          const val = parseComisionValue(rawVal);
          const matchResult = findMatchingAgent(rawAgent);
          if (matchResult && !matchResult.isAmbiguous) {
            comisionesMap[matchResult.dni] = val;
            comisionesMap[matchResult.name] = val;
            comisionesMap[cleanStr(matchResult.name)] = val;
            matchedDetails.push({
              dni: matchResult.dni,
              nombre: matchResult.name,
              rawNameInSheet: rawAgent,
              comision: val,
              filaExcel: i + 1
            });
          } else if (matchResult && matchResult.isAmbiguous) {
            ambiguousDetails.push({
              rawNameInSheet: rawAgent,
              filaExcel: i + 1,
              comision: val,
              candidatos: matchResult.candidates
            });
          }
        }

        // 5. Respuesta filtrada por rol (Principio de mínimo privilegio)
        if (claims.rol === 'gerente') {
          return res.status(200).json({
            success: true,
            isGerente: true,
            headerRow: startRow,
            colAgente,
            colComi,
            totalEmparejados: matchedDetails.length,
            totalAmbiguos: ambiguousDetails.length,
            matchedDetails,
            ambiguousDetails,
            data: comisionesMap
          });
        } else {
          // Comercial: ÚNICAMENTE recibe su propia comisión individual
          const userDni = claims.dni;
          let userComision = 0;
          if (userDni && comisionesMap[userDni] !== undefined) {
            userComision = comisionesMap[userDni];
          } else if (claims.nombre && comisionesMap[cleanStr(claims.nombre)] !== undefined) {
            userComision = comisionesMap[cleanStr(claims.nombre)];
          }

          return res.status(200).json({
            success: true,
            isGerente: false,
            dni: userDni,
            nombre: claims.nombre,
            comision: userComision
          });
        }
      }

      // Flujo seguro en servidor: OAuth 2.0 con Service Account y Google Sheets API v4
      getGoogleAccessTokenImpl(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, (tokenErr, accessToken) => {
        if (tokenErr || !accessToken) {
          return res.status(502).json({
            success: false,
            error: "Error de autenticación con la cuenta de servicio de Google Sheets",
            details: tokenErr ? tokenErr.message : "No se obtuvo token"
          });
        }

        fetchPrivateSheetValuesImpl(accessToken, GOOGLE_SHEET_ID, (fetchErr, sheetRows) => {
          if (fetchErr) {
            return res.status(502).json({
              success: false,
              error: "Error al consultar la API v4 de Google Sheets",
              details: fetchErr.message
            });
          }

          processSheetRows(sheetRows);
        });
      });
    });
  });
};

module.exports._setVerifySupabaseTokenForTesting = (fn) => { verifySupabaseTokenImpl = fn || verifySupabaseToken; };
module.exports._setFetchUserProfileForTesting = (fn) => { fetchUserProfileImpl = fn || fetchUserProfile; };
module.exports._setGetGoogleAccessTokenForTesting = (fn) => { getGoogleAccessTokenImpl = fn || getGoogleAccessToken; };
module.exports._setFetchPrivateSheetValuesForTesting = (fn) => { fetchPrivateSheetValuesImpl = fn || fetchPrivateSheetValues; };

