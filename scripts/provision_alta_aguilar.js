// ============================================================================
// SCRIPT DE ALTA SEGURA: FRANCISCO JAVIER AGUILAR CHAVES
// Archivo: scripts/provision_alta_aguilar.js
// ============================================================================
// DATOS DEL ALTA:
// - Nombre: FRANCISCO JAVIER AGUILAR CHAVES
// - DNI: 78105181D
// - Email de acceso: 78105181d@asistente.internal
// - Rol: comercial
// - Activo: true
// - must_change_password: true
// ============================================================================
// REGLAS DE SEGURIDAD ESTRICTAS:
// 1. Fuente autoritativa: Supabase Auth (auth.users) y public.agentes_perfiles.
// 2. NO se almacena el DNI como contraseña permanente ni en texto plano.
// 3. Se genera una contraseña temporal criptográfica aleatoria de alta entropía.
// 4. Se exige cambio obligatorio de contraseña en el primer acceso (must_change_password = true).
// 5. Antes de escribir en cualquier entorno, verifica que la tabla public.agentes_perfiles
//    exista. Si el destino aún depende del esquema legacy (agentes_roles), aborta inmediatamente.
// 6. Comprueba previamente si ya existe por DNI o email para evitar duplicados.
// ============================================================================

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const AGENT_DATA = {
  dni: '78105181D',
  nombre: 'FRANCISCO JAVIER AGUILAR CHAVES',
  email: '78105181d@asistente.internal',
  rol: 'comercial',
  activo: true,
  must_change_password: true
};

function generateSecureTempPassword() {
  const randomPart = crypto.randomBytes(12).toString('base64');
  return `Tmp!${randomPart}9aA#`;
}

function httpsRequest(urlStr, options, bodyData) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 10000
      };

      const req = https.request(reqOptions, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error("Timeout conectando con Supabase"));
      });

      req.on('error', err => reject(err));

      if (bodyData) {
        req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function run() {
  console.log("==================================================================");
  console.log(" ALTA SEGURA: FRANCISCO JAVIER AGUILAR CHAVES (78105181D)");
  console.log("==================================================================");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("\n[BLOQUEO DE ENTORNO] Faltan variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
    console.error("El alta está debidamente catalogada y preparada en el código.");
    console.error("Para efectuar el aprovisionamiento en base de datos, ejecuta:");
    console.error("  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision_alta_aguilar.js\n");
    process.exit(1);
  }

  // 1. Comprobar si el entorno destino cuenta con agentes_perfiles (Fase 1 migrada)
  console.log(`\nVerificando compatibilidad del esquema en: ${SUPABASE_URL}...`);
  try {
    const testPerfiles = await httpsRequest(`${SUPABASE_URL}/rest/v1/agentes_perfiles?select=dni&limit=1`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    if (testPerfiles.statusCode === 404) {
      console.error("\n==================================================================");
      console.error(" [BLOQUEO TÉCNICO] ESQUEMA DESTINO NO COMPATIBLE");
      console.error(" El proyecto destino aún depende del sistema antiguo (agentes_roles) y NO");
      console.error(" dispone de la tabla autoritativa public.agentes_perfiles.");
      console.error(" Conforme a las directrices de seguridad:");
      console.error(" - NO se introduce una cuenta en el sistema antiguo ni se restaura");
      console.error("   el almacenamiento inseguro en texto plano.");
      console.error(" - El alta queda PREPARADA para ser ejecutada inmediatamente tras la");
      console.error("   aplicación de migrations/20261008_security_auth_migration.sql.");
      console.error("==================================================================\n");
      process.exit(2);
    }
  } catch (err) {
    console.error("Error al comprobar agentes_perfiles:", err.message);
    process.exit(1);
  }

  // 2. Comprobar si ya existe en agentes_perfiles por DNI
  const existingProfile = await httpsRequest(`${SUPABASE_URL}/rest/v1/agentes_perfiles?dni=eq.${AGENT_DATA.dni}`, {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (Array.isArray(existingProfile.data) && existingProfile.data.length > 0) {
    console.log(`\n[AVISO] El agente con DNI ${AGENT_DATA.dni} ya existe en agentes_perfiles.`);
    console.log("Perfil existente:", JSON.stringify(existingProfile.data[0]));
    return;
  }

  // 3. Crear usuario en Supabase Auth
  const tempPassword = generateSecureTempPassword();
  console.log(`\nCreando identidad en Supabase Auth para ${AGENT_DATA.email}...`);

  const createAuthRes = await httpsRequest(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  }, {
    email: AGENT_DATA.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      dni: AGENT_DATA.dni,
      nombre: AGENT_DATA.nombre,
      equipo: 'Comerciales Renosur'
    }
  });

  if (createAuthRes.statusCode !== 200 && createAuthRes.statusCode !== 201) {
    console.error("Error al crear usuario en Supabase Auth:", createAuthRes.data);
    process.exit(1);
  }

  const userId = createAuthRes.data.id;
  console.log(`Usuario creado en Auth con user_id: ${userId}`);

  // 4. Crear fila autoritativa en agentes_perfiles
  console.log(`Creando perfil autoritativo en agentes_perfiles con must_change_password=true...`);
  const createProfileRes = await httpsRequest(`${SUPABASE_URL}/rest/v1/agentes_perfiles`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  }, {
    user_id: userId,
    dni: AGENT_DATA.dni,
    nombre: AGENT_DATA.nombre,
    rol: AGENT_DATA.rol,
    activo: AGENT_DATA.activo,
    must_change_password: AGENT_DATA.must_change_password
  });

  if (createProfileRes.statusCode !== 200 && createProfileRes.statusCode !== 201) {
    console.error("Error al crear perfil en agentes_perfiles:", createProfileRes.data);
    process.exit(1);
  }

  console.log("\n==================================================================");
  console.log(" [ALTA COMPLETADA CON ÉXITO]");
  console.log(` Agente: ${AGENT_DATA.nombre} (${AGENT_DATA.dni})`);
  console.log(` Rol: ${AGENT_DATA.rol} | Activo: ${AGENT_DATA.activo}`);
  console.log(` must_change_password: ${AGENT_DATA.must_change_password}`);
  console.log("==================================================================");
}

if (require.main === module) {
  run();
}

module.exports = {
  AGENT_DATA,
  generateSecureTempPassword
};
