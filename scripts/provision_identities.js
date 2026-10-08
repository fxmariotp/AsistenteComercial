// ============================================================================
// SCRIPT DE APROVISIONAMIENTO DE IDENTIDADES Y PERFILES (STAGING AISLADO)
// Archivo: scripts/provision_identities.js
// ============================================================================
// REGLA DE SEGURIDAD OBLIGATORIA:
// Este script SOLO debe ejecutarse contra un proyecto de Supabase Staging.
// Cuenta con bloqueos preventivos automáticos que abortan ante intentos de
// ejecución sobre la base de datos de producción.
// ============================================================================

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 1. GUARDA DE SEGURIDAD OBLIGATORIA: EXIGIR ESTRICTAMENTE EL FLAG CLI --confirm-staging
// Se elimina cualquier alternativa mediante NODE_ENV. Solo la confirmación explícita por CLI es válida.
const hasConfirmFlag = process.argv.includes('--confirm-staging');
if (!hasConfirmFlag) {
  console.error("\n==================================================================");
  console.error(" [BLOQUEO PREVENTIVO] CONFIRMACIÓN DE ENTORNO REQUERIDA");
  console.error(" Para evitar ejecuciones accidentales contra bases de datos equivocadas,");
  console.error(" este script exige estrictamente el flag CLI --confirm-staging.");
  console.error(" No se admite ninguna alternativa mediante variables de entorno (NODE_ENV).");
  console.error("");
  console.error("   node scripts/provision_identities.js --confirm-staging");
  console.error("==================================================================\n");
  process.exit(1);
}

// 2. GUARDA ANTI-PRODUCCIÓN
const KNOWN_PRODUCTION_IDENTIFIERS = ['bxgdtdzlijeaetlekbub', 'renosur.com'];
const hasProductionUrl = SUPABASE_URL && KNOWN_PRODUCTION_IDENTIFIERS.some(id => SUPABASE_URL.includes(id));
if (hasProductionUrl) {
  console.error("\n==================================================================");
  console.error(" [ERROR FATAL] DETECTADA URL DE PRODUCCIÓN.");
  console.error(" Este script de aprovisionamiento NO debe ejecutarse contra producción.");
  console.error(" Abortando la operación inmediatamente para proteger los datos reales.");
  console.error("==================================================================\n");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: Debes definir las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Ejemplo: SUPABASE_URL=https://<staging>.supabase.co SUPABASE_SERVICE_ROLE_KEY=secret node scripts/provision_identities.js --confirm-staging");
  process.exit(1);
}

// 3. VERIFICACIÓN DE DESTINO EXACTO CONTRA EL PROYECTO DE STAGING CONFIGURADO
function getStagingUrlFromConfig() {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.resolve(__dirname, '../config.js');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/SUPABASE_URL\s*:\s*["']([^"']+)["']/);
      if (match && match[1] && !match[1].includes('<tu-proyecto-supabase>') && match[1].trim() !== '') {
        return match[1].trim();
      }
    }
  } catch (_) {}
  return "";
}

const configuredStagingUrl = process.env.EXPECTED_STAGING_URL || 
                             process.env.STAGING_SUPABASE_URL || 
                             getStagingUrlFromConfig();

if (!configuredStagingUrl) {
  console.error("\n==================================================================");
  console.error(" [ERROR] PROYECTO DE STAGING NO CONFIGURADO");
  console.error(" Se exige comprobar que el destino coincida exactamente con el proyecto");
  console.error(" de staging configurado antes de cualquier escritura.");
  console.error(" Define EXPECTED_STAGING_URL (o STAGING_SUPABASE_URL o SUPABASE_URL en config.js).");
  console.error("==================================================================\n");
  process.exit(1);
}

const normalizeUrl = (u) => (u || '').trim().replace(/\/+$/, '').toLowerCase();
if (normalizeUrl(SUPABASE_URL) !== normalizeUrl(configuredStagingUrl)) {
  console.error("\n==================================================================");
  console.error(" [ERROR FATAL] DISCREPANCIA EN EL DESTINO DE STAGING");
  console.error(` SUPABASE_URL destino:          ${SUPABASE_URL}`);
  console.error(` Staging configurado esperado:  ${configuredStagingUrl}`);
  console.error(" El destino no coincide exactamente con el proyecto de staging configurado.");
  console.error(" Abortando cualquier operación de escritura para evitar modificaciones erróneas.");
  console.error("==================================================================\n");
  process.exit(1);
}

// Generador de contraseñas temporales aleatorias de alta entropía
function generateSecureTempPassword() {
  const randomPart = crypto.randomBytes(12).toString('base64');
  return `Tmp!${randomPart}9aA#`;
}

// 2. SEIS CUENTAS FICTICIAS Y ANONIMIZADAS ALINEADAS CON LA GUÍA DE STAGING
const STAGING_AGENTS = [
  {
    dni: "00000001A",
    nombre: "COMERCIAL TEST A",
    rol: "comercial",
    activo: true,
    must_change_password: false,
    tempPassword: generateSecureTempPassword()
  },
  {
    dni: "00000002B",
    nombre: "COMERCIAL TEST B",
    rol: "comercial",
    activo: true,
    must_change_password: false,
    tempPassword: generateSecureTempPassword()
  },
  {
    dni: "00000003G",
    nombre: "GERENTE TEST",
    rol: "gerente",
    activo: true,
    must_change_password: false,
    tempPassword: generateSecureTempPassword()
  },
  {
    dni: "00000004E",
    nombre: "EVARIA TEST",
    rol: "evaria",
    activo: true,
    must_change_password: false,
    tempPassword: generateSecureTempPassword()
  },
  {
    dni: "00000005I",
    nombre: "INACTIVO TEST",
    rol: "comercial",
    activo: false, // CUENTA INACTIVA DESACTIVADA
    must_change_password: false,
    tempPassword: generateSecureTempPassword()
  },
  {
    dni: "00000006X",
    nombre: "CAMBIO PENDIENTE TEST",
    rol: "comercial",
    activo: true,
    must_change_password: true, // CAMBIO OBLIGATORIO PENDIENTE
    tempPassword: generateSecureTempPassword()
  }
];

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const postData = body ? JSON.stringify(body) : null;
    
    const options = {
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(url, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = raw ? JSON.parse(raw) : null;
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function provisionAgent(agent) {
  const email = `${agent.dni.toLowerCase()}@asistente.internal`;
  console.log(`\n--- Aprovisionando: ${agent.dni} | Rol: ${agent.rol} | Activo: ${agent.activo} | MustChange: ${agent.must_change_password} ---`);

  let userId = null;

  // 1. Crear o localizar usuario en auth.users mediante Supabase Admin API
  try {
    const createRes = await makeRequest('POST', '/auth/v1/admin/users', {
      email,
      password: agent.tempPassword,
      email_confirm: true,
      user_metadata: {
        dni: agent.dni,
        nombre: agent.nombre
      }
    });
    userId = createRes.data.id;
    console.log(` [OK] Usuario creado en auth.users (ID: ${userId})`);
  } catch (err) {
    if (err.message.includes('already registered') || err.message.includes('unique constraint') || err.message.includes('422')) {
      console.log(` [INFO] Usuario ya registrado en Auth, actualizando contraseña temporal...`);
      const listRes = await makeRequest('GET', `/auth/v1/admin/users?per_page=100`);
      const found = listRes.data?.users?.find(u => u.email === email);
      if (found) {
        userId = found.id;
        await makeRequest('PUT', `/auth/v1/admin/users/${userId}`, {
          password: agent.tempPassword
        });
        console.log(` [OK] Localizado ID existente: ${userId} y contraseña restablecida`);
      } else {
        throw new Error(`Usuario existente no encontrado en listado: ${email}`);
      }
    } else {
      throw err;
    }
  }

  // 2. Insertar o actualizar registro de perfil en public.agentes_perfiles
  console.log(` Registrando perfil autoritativo en public.agentes_perfiles...`);
  const profilePayload = {
    user_id: userId,
    dni: agent.dni,
    nombre: agent.nombre,
    rol: agent.rol,
    activo: agent.activo,
    must_change_password: agent.must_change_password,
    updated_at: new Date().toISOString()
  };

  try {
    await makeRequest('POST', '/rest/v1/agentes_perfiles', profilePayload);
    console.log(` [OK] Perfil insertado exitosamente.`);
  } catch (err) {
    if (err.message.includes('duplicate key') || err.message.includes('409')) {
      console.log(` [INFO] Perfil ya existía, aplicando actualización atómica de estado...`);
      await makeRequest('PATCH', `/rest/v1/agentes_perfiles?dni=eq.${agent.dni}`, {
        user_id: userId,
        nombre: agent.nombre,
        rol: agent.rol,
        activo: agent.activo,
        must_change_password: agent.must_change_password,
        updated_at: new Date().toISOString()
      });
      console.log(` [OK] Perfil actualizado exitosamente.`);
    } else {
      throw err;
    }
  }

  return {
    dni: agent.dni,
    nombre: agent.nombre,
    rol: agent.rol,
    email: email,
    password: agent.tempPassword,
    activo: agent.activo,
    must_change_password: agent.must_change_password
  };
}

async function run() {
  console.log("==================================================================");
  console.log(" INICIANDO APROVISIONAMIENTO EN ENTORNO AISLADO (STAGING)");
  console.log(` Destino: ${SUPABASE_URL}`);
  console.log("==================================================================");

  const results = [];
  for (const agent of STAGING_AGENTS) {
    try {
      const res = await provisionAgent(agent);
      results.push(res);
    } catch (err) {
      console.error(` [ERROR] Fallo al aprovisionar ${agent.dni}:`, err.message);
    }
  }

  console.log("\n==================================================================");
  console.log(" RESUMEN DE IDENTIDADES DE STAGING APROVISIONADAS (GUARDAR)");
  console.log("==================================================================");
  console.table(results.map(r => ({
    DNI: r.dni,
    Rol: r.rol,
    Activo: r.activo,
    MustChange: r.must_change_password,
    Email: r.email,
    PasswordTemporal: r.password
  })));
  console.log("==================================================================");
}

run().catch(console.error);
