// ============================================================================
// SCRIPT DE APROVISIONAMIENTO DE IDENTIDADES Y PERFILES - ASISTENTE COMERCIAL
// Archivo: scripts/provision_identities.js
// ============================================================================

const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: Debes definir las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Ejemplo: SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=secret node scripts/provision_identities.js");
  process.exit(1);
}

// Conjunto de identidades para pruebas en Staging (Datos 100% ficticios y anonimizados)
const STAGING_AGENTS = [
  {
    dni: "00000001A",
    nombre: "COMERCIAL TEST A",
    rol: "comercial",
    tempPassword: "TempPassword2026!"
  },
  {
    dni: "00000002B",
    nombre: "COMERCIAL TEST B",
    rol: "comercial",
    tempPassword: "TempPassword2026!"
  },
  {
    dni: "00000003G",
    nombre: "GERENTE TEST",
    rol: "gerente",
    tempPassword: "TempPassword2026!"
  },
  {
    dni: "00000004E",
    nombre: "TRABAJADOR EVARIA TEST",
    rol: "evaria",
    tempPassword: "TempPassword2026!"
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
  console.log(`\n--- Aprovisionando agente: ${agent.dni} (${agent.rol}) ---`);

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
    console.log(` [OK] Usuario creado en auth.users con ID: ${userId}`);
  } catch (err) {
    if (err.message.includes('already registered') || err.message.includes('unique constraint') || err.message.includes('422')) {
      console.log(` [INFO] El usuario ya existe en auth.users, consultando ID...`);
      const listRes = await makeRequest('GET', `/auth/v1/admin/users?per_page=100`);
      const found = listRes.data?.users?.find(u => u.email === email);
      if (found) {
        userId = found.id;
        console.log(` [OK] Localizado ID existente: ${userId}`);
      } else {
        throw new Error(`Usuario existente no encontrado en listado: ${email}`);
      }
    } else {
      throw err;
    }
  }

  // 2. Insertar o actualizar registro de perfil en public.agentes_perfiles
  // Nota: must_change_password se establece explícitamente en TRUE por el servidor
  console.log(` Registrando perfil autoritativo en public.agentes_perfiles...`);
  const profilePayload = {
    user_id: userId,
    dni: agent.dni,
    nombre: agent.nombre,
    rol: agent.rol,
    activo: true,
    must_change_password: true,
    updated_at: new Date().toISOString()
  };

  try {
    await makeRequest('POST', '/rest/v1/agentes_perfiles', profilePayload);
    console.log(` [OK] Perfil registrado con must_change_password=true.`);
  } catch (err) {
    if (err.message.includes('duplicate key') || err.message.includes('409')) {
      console.log(` [INFO] Perfil ya existía, actualizando estado de control...`);
      await makeRequest('PATCH', `/rest/v1/agentes_perfiles?dni=eq.${agent.dni}`, {
        user_id: userId,
        rol: agent.rol,
        activo: true,
        must_change_password: true,
        updated_at: new Date().toISOString()
      });
      console.log(` [OK] Perfil actualizado exitosamente.`);
    } else {
      throw err;
    }
  }
}

async function run() {
  console.log("==================================================================");
  console.log(" INICIANDO APROVISIONAMIENTO EN ENTORNO AISLADO (STAGING)");
  console.log(` Destino: ${SUPABASE_URL}`);
  console.log("==================================================================");

  for (const agent of STAGING_AGENTS) {
    try {
      await provisionAgent(agent);
    } catch (err) {
      console.error(` [ERROR] Fallo al aprovisionar ${agent.dni}:`, err.message);
    }
  }

  console.log("\n==================================================================");
  console.log(" APROVISIONAMIENTO COMPLETADO.");
  console.log(" Todos los usuarios quedan en estado must_change_password = true.");
  console.log("==================================================================");
}

run().catch(console.error);
