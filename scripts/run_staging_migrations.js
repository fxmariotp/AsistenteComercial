// ============================================================================
// SCRIPT DE EJECUCIÓN DE MIGRACIONES EN STAGING VÍA SUPABASE MANAGEMENT API
// Archivo: scripts/run_staging_migrations.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// 1. Cargar .env local
function loadLocalEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
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
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadLocalEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const EXPECTED_STAGING_URL = process.env.EXPECTED_STAGING_URL || '';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';

// 2. Guardas de seguridad estrictas
const KNOWN_PRODUCTION_IDENTIFIERS = ['bxgdtdzlijeaetlekbub', 'renosur.com'];
if (KNOWN_PRODUCTION_IDENTIFIERS.some(id => SUPABASE_URL.includes(id))) {
  console.error('[ERROR FATAL] Detectada URL de producción. Abortando.');
  process.exit(1);
}

const normalize = (u) => (u || '').trim().replace(/\/+$/, '').toLowerCase();
if (!SUPABASE_URL || normalize(SUPABASE_URL) !== normalize(EXPECTED_STAGING_URL)) {
  console.error('[ERROR] SUPABASE_URL y EXPECTED_STAGING_URL deben coincidir exactamente.');
  process.exit(1);
}

if (!ACCESS_TOKEN) {
  console.error('[BLOQUEO] Falta SUPABASE_ACCESS_TOKEN en el archivo .env.');
  console.error('El administrador debe configurar un token de gestión (sbp_...) para autorizar la ejecución DDL.');
  process.exit(2);
}

const stagingRef = new URL(SUPABASE_URL).hostname.split('.')[0];
console.log(`[STAGING] Proyecto destino: ${stagingRef}`);

function executeSql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${stagingRef}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: json });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: raw });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('\n--- PASO 1: Ejecutando migrations/20261007_base_schema.sql ---');
  const sql1 = fs.readFileSync(path.resolve(__dirname, '../migrations/20261007_base_schema.sql'), 'utf8');
  await executeSql(sql1);
  console.log('[OK] migrations/20261007_base_schema.sql ejecutada con éxito.');

  console.log('\n--- PASO 2: Ejecutando migrations/20261008_security_auth_migration.sql ---');
  const sql2 = fs.readFileSync(path.resolve(__dirname, '../migrations/20261008_security_auth_migration.sql'), 'utf8');
  await executeSql(sql2);
  console.log('[OK] migrations/20261008_security_auth_migration.sql ejecutada con éxito.');

  console.log('\n[ÉXITO] Migraciones DDL completadas en staging. El esquema está listo.');
}

run().catch((err) => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
