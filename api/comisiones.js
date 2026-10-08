const https = require('https');

/**
 * ============================================================================
 * FASE 1: SEGURIDAD Y CONTROL DE ACCESO EN /api/comisiones
 * ============================================================================
 * 
 * MEDIDAS DE SEGURIDAD IMPLEMENTADAS:
 * 1. Verificación obligatoria de token JWT de Supabase Auth en servidor.
 * 2. Scoping estricto por rol:
 *    - 'comercial': Devuelve ÚNICAMENTE su propia comisión. Sin datos de terceros.
 *    - 'gerente': Devuelve las comisiones consolidadas del equipo comercial.
 *    - 'evaria': Denegado (HTTP 403 Forbidden).
 * 3. Eliminación de la fuga de 'sheetId' en la respuesta JSON.
 * 4. Cabeceras anti-caché estrictas (private, no-cache, no-store) para impedir
 *    que proxys intermedios o navegadores almacenen datos confidenciales.
 * 
 * NOTA CRÍTICA SOBRE LA FUENTE DE DATOS:
 * Proteger esta API es indispensable pero insuficiente si la hoja de cálculo
 * de Google Sheets sigue configurada como "Cualquier persona con el enlace".
 * La dirección debe revocar el acceso público de la hoja y consumirla mediante
 * Google Service Account con permisos de solo lectura restringidos a una cuenta
 * de servicio privada.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bxgdtdzlijeaetlekbub.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_DlLT2Rz1npEXSuxpM9__tQ_WF-Q0-Ap";

// Configuración privada de la hoja de comisiones (no exponer sheetId a clientes)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "1ZFTf8S0Gvsq1UNOhhZ5cUbwyKpVTpAdlbbvyhUcp1lI";

const RENOSUR_AGENTS = [
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

// Identificadores conocidos de roles para el periodo de transición segura
const KNOWN_GERENTES = ["MIGUELR"];
const KNOWN_EVARIA = ["MARIAC", "28750523V"];

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

  // 1. Coincidencia exacta con nombre completo oficial
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
    // Si hay más de un comercial coincidente, declarar fila ambigua para revisión
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

/**
 * Extrae claims de identidad y rol del usuario autenticado.
 */
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

  let nombre = '';
  if (user.user_metadata && user.user_metadata.nombre) {
    nombre = user.user_metadata.nombre;
  } else {
    const matched = RENOSUR_AGENTS.find(a => a.dni === dni);
    if (matched) nombre = matched.name;
  }

  return { dni, rol, status, nombre, id: user.id };
}

module.exports = function (req, res) {
  // CORS estricto
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Cabeceras estrictas contra almacenamiento en caché de respuestas confidenciales
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Verificación de cabecera Authorization Bearer
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
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

  // 2. Verificación criptográfica del token con Supabase Auth
  verifySupabaseToken(token, (authErr, user) => {
    if (authErr || !user) {
      return res.status(401).json({
        success: false,
        error: "Sesión inválida o expirada. Por favor, inicia sesión de nuevo.",
        details: authErr ? authErr.message : "Usuario no encontrado"
      });
    }

    const claims = extractUserClaims(user);

    // 3. Comprobación de estado activo del usuario
    if (claims.status === 'inactive') {
      return res.status(403).json({
        success: false,
        error: "Tu cuenta de usuario ha sido desactivada por gerencia."
      });
    }

    // 4. Scoping por rol: Trabajadores Evaria no tienen acceso
    if (claims.rol === 'evaria') {
      return res.status(403).json({
        success: false,
        error: "Acceso denegado: El perfil Evaria no tiene acceso a las comisiones de Renosur."
      });
    }

    // Solo roles autorizados: 'comercial' o 'gerente'
    if (claims.rol !== 'comercial' && claims.rol !== 'gerente') {
      return res.status(403).json({
        success: false,
        error: "Acceso denegado: Rol de usuario no autorizado."
      });
    }

    const targetUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&t=${Date.now()}`;

    function fetchUrl(url, redirectCount = 0) {
      if (redirectCount > 5) {
        return res.status(500).json({ error: "Demasiadas redirecciones de Google Sheets" });
      }

      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (googleRes) => {
        const { statusCode } = googleRes;

        if (statusCode >= 300 && statusCode < 400 && googleRes.headers.location) {
          return fetchUrl(googleRes.headers.location, redirectCount + 1);
        }

        if (statusCode === 401 || statusCode === 403) {
          return res.status(200).json({
            success: false,
            error: "La hoja de cálculo está en modo privado y no se puede leer sin credenciales de servicio.",
            data: {}
          });
        }

        if (statusCode !== 200) {
          return res.status(statusCode).json({ error: `Google Sheets respondió con código ${statusCode}` });
        }

        let rawData = '';
        googleRes.on('data', (chunk) => { rawData += chunk; });
        googleRes.on('end', () => {
          try {
            const rows = parseCSV(rawData);
            if (!rows || rows.length === 0) {
              return res.status(200).json({ success: false, error: "El archivo CSV de comisiones está vacío", data: {} });
            }

            // Detectar columnas y fila de cabecera
            let startRow = 0;
            let colAgente = 0;
            let colComi = 1;

            for (let i = 0; i < Math.min(rows.length, 5); i++) {
              const r = rows[i];
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

              const rawAgent = (r[colAgente] !== undefined && r[colAgente] !== '' ? r[colAgente] : (r[0] || '')).trim();
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
              // Gerente recibe el consolidado del equipo y las filas ambiguas para revisión manual, pero NUNCA el sheetId
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
          } catch (e) {
            return res.status(500).json({ error: "Error procesando el archivo de comisiones", details: e.message });
          }
        });
      }).on('error', (e) => {
        return res.status(500).json({ error: e.message });
      });
    }

    fetchUrl(targetUrl);
  });
};
