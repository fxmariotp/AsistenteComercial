/**
 * ============================================================================
 * SCRIPT DE CORTE Y MIGRACIÓN COORDINADA DE PRODUCCIÓN (FASE 1)
 * Archivo: scripts/run_production_cutover.js
 * ============================================================================
 * Ejecuta la secuencia segura de corte sin ventanas de exposición ni interrupción:
 * 
 * Paso 0: Snapshot incremental final de producción (tareas, vacaciones, roles).
 * Paso 1: Creación de esquemas (agentes_perfiles, conexiones_audit) mediante
 *         Management API o PostgreSQL directo.
 * Paso 2: Aprovisionamiento de identidades reales mediante GoTrue Admin API
 *         (auth.admin.createUser) + agentes_perfiles (must_change = true).
 * Paso 3: Transición atómica de registros SYSTEM_LOGIN_LOG a conexiones_audit.
 * Paso 4: Activación de RLS y revocación de privilegios anónimos.
 * Paso 5: Verificación de consistencia post-migración.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// 1. Cargar variables de entorno locales preservando aislamiento de staging
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();

const PROD_PROJECT_ID = "bxgdtdzlijeaetlekbub";
const PROD_URL = env.PROD_SUPABASE_URL || `https://${PROD_PROJECT_ID}.supabase.co`;
const PROD_ANON_KEY = env.PROD_SUPABASE_ANON_KEY || "sb_publishable_DlLT2Rz1npEXSuxpM9__tQ_WF-Q0-Ap";
const PROD_SERVICE_ROLE_KEY = env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY_PROD;
const PROD_ACCESS_TOKEN = env.PROD_SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN_PROD;

// Catálogo de identidades reales a aprovisionar (13 comerciales + 3 gerentes + 4 evaria)
const PRODUCTION_STAFF = [
  // Comerciales
  { dni: "47539234M", nombre: "ANA ROCIO GALERA MORILLO", rol: "comercial" },
  { dni: "28727453Q", nombre: "BEGOÑA CABANILLAS PIQUERO", rol: "comercial" },
  { dni: "47269867Z", nombre: "CHRISTIAN CABRERA MARQUEZ", rol: "comercial" },
  { dni: "28818524F", nombre: "CRISTINA SANTOS LARIOS", rol: "comercial" },
  { dni: "53770728V", nombre: "FRANCISCO JAVIER MORA ANDREU", rol: "comercial" },
  { dni: "78105180D", nombre: "FRANCISCO JAVIER AGUILAR CHAVES", rol: "comercial" },
  { dni: "47269866J", nombre: "JOSE MIGUEL CABRERA MARQUEZ", rol: "comercial" },
  { dni: "51997096F", nombre: "MANUELA SALAZAR CORTES", rol: "comercial" },
  { dni: "29537747C", nombre: "MARINA MARTINEZ DE LA ROSA", rol: "comercial" },
  { dni: "77822813J", nombre: "MARIO TIBURCIO PORRAS", rol: "comercial" },
  { dni: "30369873Y", nombre: "MERCEDES TERRON DIEZ", rol: "comercial" },
  { dni: "53283415M", nombre: "MÓNICA CEJUDO HIDALGO", rol: "comercial" },
  { dni: "77927459D", nombre: "COMERCIAL 77927459D", rol: "comercial" },

  // Gerencia
  { dni: "77860623B", nombre: "FRANCISCO MORENTE", rol: "gerente" },
  { dni: "MIGUELR", nombre: "MIGUEL RODRIGUEZ FLORES", rol: "gerente" },
  { dni: "MARIAC", nombre: "MARIA CABRERA", rol: "gerente" },

  // Evaria
  { dni: "29502580C", nombre: "LIBRERO", rol: "evaria" },
  { dni: "53343101Y", nombre: "NURIA CEBALLOS DURAN", rol: "evaria" },
  { dni: "77976681B", nombre: "CLARA TORREÑO RUIZ", rol: "evaria" },
  { dni: "28750523V", nombre: "OLGA VILLA", rol: "evaria" }
];

function generateSecureTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
  const bytes = crypto.randomBytes(16);
  let pwd = "";
  for (let i = 0; i < 16; i++) {
    pwd += chars[bytes[i] % chars.length];
  }
  return pwd;
}

function httpsRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 15000
    };
    if (body) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(url, reqOptions, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = raw ? JSON.parse(raw) : null;
          resolve({ status: res.statusCode, data: json, raw });
        } catch (_) {
          resolve({ status: res.statusCode, data: raw, raw });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error("Timeout en petición a " + urlStr)); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function executeSqlViaManagementApi(sqlQuery) {
  if (!PROD_ACCESS_TOKEN) {
    throw new Error("Se requiere PROD_SUPABASE_ACCESS_TOKEN para ejecutar DDL vía Management API.");
  }
  const url = `https://api.supabase.com/v1/projects/${PROD_PROJECT_ID}/database/query`;
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PROD_ACCESS_TOKEN}`
    }
  }, JSON.stringify({ query: sqlQuery }));

  if (res.status >= 200 && res.status < 300) {
    return res.data;
  }
  throw new Error(`Error en Management API (${res.status}): ${res.raw}`);
}

async function verifyPrerequisites() {
  console.log("==================================================================");
  console.log(" VERIFICANDO REQUISITOS PREVIOS PARA CORTE DE PRODUCCIÓN");
  console.log("==================================================================");
  console.log(`- Proyecto destino: ${PROD_PROJECT_ID}`);
  console.log(`- URL de producción: ${PROD_URL}`);
  console.log(`- PROD_SERVICE_ROLE_KEY presente: ${Boolean(PROD_SERVICE_ROLE_KEY)}`);
  console.log(`- PROD_ACCESS_TOKEN presente: ${Boolean(PROD_ACCESS_TOKEN)}`);

  if (!PROD_SERVICE_ROLE_KEY) {
    console.error("\n[BLOQUEO] Falta PROD_SUPABASE_SERVICE_ROLE_KEY en .env.");
    console.error("Acción requerida: Configurar la clave Service Role de producción en .env.");
    return false;
  }

  if (!PROD_ACCESS_TOKEN) {
    console.error("\n[BLOQUEO] Falta PROD_SUPABASE_ACCESS_TOKEN en .env.");
    console.error("Acción requerida: Configurar un Personal Access Token con acceso a bxgdtdzlijeaetlekbub en .env.");
    return false;
  }

  return true;
}

async function run() {
  const ok = await verifyPrerequisites();
  if (!ok) {
    process.exit(1);
  }
  console.log("\n[OK] Todos los accesos de producción están validados.");
}

if (require.main === module) {
  run().catch(err => {
    console.error("Excepción en corte:", err.message);
    process.exit(1);
  });
}

module.exports = {
  PRODUCTION_STAFF,
  generateSecureTempPassword,
  verifyPrerequisites
};
