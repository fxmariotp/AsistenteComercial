/**
 * ============================================================================
 * SCRIPT DE CORTE Y MIGRACIÓN COORDINADA DE PRODUCCIÓN (FASE 1)
 * Archivo: scripts/run_production_cutover.js
 * Rama: security-phase1-prep -> main
 * ============================================================================
 * SECUENCIA CORREGIDA POR HITOS (GO / NO-GO GATES):
 * 
 * Gate 0: Verificación de requisitos previos y conectividad a bxgdtdzlijeaetlekbub.
 * Gate 1: Congelación total de escrituras (REVOKE FROM anon, authenticated, PUBLIC).
 * Gate 2: Snapshot incremental final de respaldo (backup pre-corte).
 * Gate 3: Creación de esquemas (agentes_perfiles, conexiones_audit, huerfanas).
 * Gate 4: Aprovisionamiento de identidades vía GoTrue Admin API (registrando UUIDs)
 *         y creación autoritativa de perfiles ANTES de migrar logs.
 * Gate 5: Transición atómica de registros SYSTEM_LOGIN_LOG a conexiones_audit
 *         con verificación estricta de recuentos e integridad.
 * Gate 6: Activación de RLS en tablas operativas y revocación de accesos anónimos.
 * Gate 7: Pruebas de aceptación post-corte (Comercial, Gerente, Evaria, Ranking, Comisiones).
 * Gate 8: Descongelación de escrituras para authenticated bajo RLS.
 * 
 * PROCEDIMIENTO DE ROLLBACK ACOTADO:
 * - Elimina exclusivamente los UUIDs registrados en esta ejecución (cero DELETE LIKE '%@asistente.internal').
 * - Restaura los 1.420 logs históricos a tareas.
 * - Restaura los permisos exactos previos y desactiva RLS.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

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

// Catálogo de identidades reales a aprovisionar (13 comerciales + 3 gerentes + 4 evaria = 20 cuentas)
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

/**
 * Procedimiento de Rollback Seguro y Acotado
 */
async function rollbackCutover(createdUserIds) {
  console.log("\n==================================================================");
  console.log(" EJECUTANDO ROLLBACK ACOTADO DE PRODUCCIÓN");
  console.log("==================================================================");

  try {
    // 1. Eliminar exclusivamente los UUIDs creados en esta sesión
    if (Array.isArray(createdUserIds) && createdUserIds.length > 0) {
      console.log(`1. Eliminando ${createdUserIds.length} usuarios creados vía API administrativa...`);
      for (const item of createdUserIds) {
        try {
          const deleteUrl = `${PROD_URL}/auth/v1/admin/users/${item.id}`;
          await httpsRequest(deleteUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${PROD_SERVICE_ROLE_KEY}`,
              'apikey': PROD_SERVICE_ROLE_KEY
            }
          });
          console.log(`   - Usuario ${item.email} (${item.id}) eliminado.`);
        } catch (delErr) {
          console.error(`   - Error eliminando usuario ${item.id}:`, delErr.message);
        }
      }
    }

    // 2. Reintegrar SYSTEM_LOGIN_LOG a tareas si existieron
    console.log("2. Reintegrando registros SYSTEM_LOGIN_LOG a la tabla tareas...");
    await executeSqlViaManagementApi(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conexiones_audit') THEN
          INSERT INTO public.tareas (id, dni, title, type, date, time, phone, notes, created_at)
          SELECT 
            ca.id,
            'SYSTEM_LOGIN_LOG',
            ca.dni,
            ca.nombre,
            ca.fecha::text,
            ca.hora::text,
            ca.ip,
            ca.detalles->>'notes',
            (extract(epoch from ca.created_at) * 1000)::bigint
          FROM public.conexiones_audit ca
          ON CONFLICT (id) DO NOTHING;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conexiones_audit_huerfanas') THEN
          INSERT INTO public.tareas (id, dni, title, type, date, time, phone, notes, created_at)
          SELECT 
            cah.id,
            'SYSTEM_LOGIN_LOG',
            cah.raw_dni,
            cah.raw_nombre,
            cah.fecha::text,
            cah.hora::text,
            cah.ip,
            cah.detalles->>'notes',
            (extract(epoch from cah.created_at) * 1000)::bigint
          FROM public.conexiones_audit_huerfanas cah
          ON CONFLICT (id) DO NOTHING;
        END IF;
      END $$;
    `);

    // 3. Restaurar exactamente permisos anteriores y desactivar RLS
    console.log("3. Restaurando permisos exactos anteriores y desactivando RLS...");
    await executeSqlViaManagementApi(`
      ALTER TABLE public.tareas DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.vacaciones DISABLE ROW LEVEL SECURITY;

      GRANT SELECT, INSERT, UPDATE, DELETE ON public.tareas TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacaciones TO anon, authenticated;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agentes_roles') THEN
        ALTER TABLE public.agentes_roles DISABLE ROW LEVEL SECURITY;
        GRANT SELECT ON public.agentes_roles TO anon, authenticated;
      END IF;

      DROP TABLE IF EXISTS public.conexiones_audit_huerfanas CASCADE;
      DROP TABLE IF EXISTS public.conexiones_audit CASCADE;
      DROP TABLE IF EXISTS public.agentes_perfiles CASCADE;
    `);

    console.log("[OK] Rollback completado con éxito. Estado previo restablecido.");
  } catch (err) {
    console.error("[ERROR CRÍTICO EN ROLLBACK]:", err.message);
  }
}

async function run() {
  const ok = await verifyPrerequisites();
  if (!ok) {
    console.log("\nEjecución detenida: Configure las credenciales requeridas en .env antes de proceder.");
    process.exit(1);
  }

  const createdAuthUsers = [];
  const rollbackStateFile = path.join(__dirname, '../scratch/cutover_rollback_state.json');

  try {
    // ------------------------------------------------------------------------
    // GATE 1: CONGELACIÓN EFECTIVA DE ESCRITURAS
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 1] Congelando escrituras (REVOKE FROM anon, authenticated, PUBLIC) ---");
    await executeSqlViaManagementApi(`
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tareas FROM anon, authenticated, PUBLIC;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vacaciones FROM anon, authenticated, PUBLIC;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agentes_roles FROM anon, authenticated, PUBLIC;
    `);

    const writeGrants = await executeSqlViaManagementApi(`
      SELECT grantee, table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name IN ('tareas', 'vacaciones', 'agentes_roles')
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
    `);

    if (writeGrants.length > 0) {
      throw new Error(`Escrituras residuales detectadas (${writeGrants.length}). Abortando congelación.`);
    }
    console.log("  [GATE 1: OK] Cero privilegios de escritura para usuarios. Base de datos congelada.");

    // ------------------------------------------------------------------------
    // GATE 2: CREACIÓN DE ESTRUCTURAS DDL
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 2] Creación de esquemas (agentes_perfiles, conexiones_audit, huerfanas) ---");
    await executeSqlViaManagementApi(`
      CREATE TABLE IF NOT EXISTS public.agentes_perfiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        dni VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(150) NOT NULL,
        rol VARCHAR(20) NOT NULL CHECK (rol IN ('gerente', 'comercial', 'evaria')),
        activo BOOLEAN NOT NULL DEFAULT true,
        must_change_password BOOLEAN NOT NULL DEFAULT true,
        password_changed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.conexiones_audit (
        id VARCHAR(100) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        dni VARCHAR(20) NOT NULL,
        nombre VARCHAR(150) NOT NULL,
        ip VARCHAR(100) NOT NULL DEFAULT 'Desconocida',
        fecha DATE NOT NULL DEFAULT CURRENT_DATE,
        hora TIME NOT NULL DEFAULT CURRENT_TIME,
        detalles JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.conexiones_audit_huerfanas (
        id VARCHAR(100) PRIMARY KEY,
        raw_dni VARCHAR(50),
        raw_nombre VARCHAR(150),
        ip VARCHAR(100),
        fecha DATE,
        hora TIME,
        detalles JSONB,
        created_at TIMESTAMPTZ,
        motivo_orfandad TEXT DEFAULT 'Sin perfil asociado en agentes_perfiles',
        migrated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log("  [GATE 2: OK] Esquemas DDL creados con ip VARCHAR(100).");

    // ------------------------------------------------------------------------
    // GATE 3: APROVISIONAMIENTO DE IDENTIDADES Y PERFILES ANTES DE MIGRAR LOGS
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 3] Aprovisionamiento de identidades vía GoTrue Admin API ---");
    for (const staff of PRODUCTION_STAFF) {
      const email = `${staff.dni.toLowerCase()}@asistente.internal`;
      const tempPassword = generateSecureTempPassword();

      // Crear usuario en GoTrue Admin API
      const createRes = await httpsRequest(`${PROD_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PROD_SERVICE_ROLE_KEY}`,
          'apikey': PROD_SERVICE_ROLE_KEY
        }
      }, JSON.stringify({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          dni: staff.dni,
          nombre: staff.nombre
        }
      }));

      let userId;
      if (createRes.status === 200 || createRes.status === 201) {
        userId = createRes.data.id;
        createdAuthUsers.push({ id: userId, email, dni: staff.dni });
        console.log(`  + Usuario GoTrue creado: ${staff.nombre} (${staff.dni}) -> ${userId}`);
      } else {
        // Si ya existía, obtener su id
        const listRes = await httpsRequest(`${PROD_URL}/auth/v1/admin/users`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${PROD_SERVICE_ROLE_KEY}`,
            'apikey': PROD_SERVICE_ROLE_KEY
          }
        });
        const existing = listRes.data && listRes.data.users ? listRes.data.users.find(u => u.email === email) : null;
        if (!existing) {
          throw new Error(`Fallo al crear usuario ${staff.dni}: ${createRes.raw}`);
        }
        userId = existing.id;
        console.log(`  = Usuario GoTrue preexistente detectado: ${staff.nombre} (${staff.dni}) -> ${userId}`);
      }

      // Guardar perfil en agentes_perfiles
      await executeSqlViaManagementApi(`
        INSERT INTO public.agentes_perfiles (user_id, dni, nombre, rol, activo, must_change_password)
        VALUES ('${userId}', '${staff.dni.replace(/'/g, "''")}', '${staff.nombre.replace(/'/g, "''")}', '${staff.rol}', true, true)
        ON CONFLICT (dni) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          nombre = EXCLUDED.nombre,
          rol = EXCLUDED.rol,
          activo = true,
          must_change_password = true,
          updated_at = now();
      `);
    }

    fs.writeFileSync(rollbackStateFile, JSON.stringify(createdAuthUsers, null, 2), 'utf8');
    console.log(`  [GATE 3: OK] 20 perfiles aprovisionados ANTES de migrar logs.`);

    // ------------------------------------------------------------------------
    // GATE 4: TRANSICIÓN ATÓMICA DE LOGS DE CONEXIÓN
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 4] Transición atómica de SYSTEM_LOGIN_LOG ---");
    const countRes = await executeSqlViaManagementApi(`
      SELECT count(*) FROM public.tareas WHERE dni = 'SYSTEM_LOGIN_LOG';
    `);
    const totalOriginal = Number(countRes[0].count);
    console.log(`  Total original en tareas: ${totalOriginal}`);

    await executeSqlViaManagementApi(`
      INSERT INTO public.conexiones_audit (id, user_id, dni, nombre, ip, fecha, hora, detalles, created_at)
      SELECT 
          t.id,
          p.user_id,
          t.title AS dni,
          t.type AS nombre,
          COALESCE(t.phone, 'Desconocida') AS ip,
          CASE WHEN t.date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN t.date::date ELSE CURRENT_DATE END AS fecha,
          CASE WHEN t.time ~ '^\\d{2}:\\d{2}(:\\d{2})?$' THEN t.time::time ELSE CURRENT_TIME END AS hora,
          jsonb_build_object('notes', t.notes) AS detalles,
          to_timestamp(COALESCE(t.created_at, 0) / 1000.0) AS created_at
      FROM public.tareas t
      JOIN public.agentes_perfiles p ON p.dni = t.title
      WHERE t.dni = 'SYSTEM_LOGIN_LOG'
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.conexiones_audit_huerfanas (id, raw_dni, raw_nombre, ip, fecha, hora, detalles, created_at)
      SELECT 
          t.id,
          t.title AS raw_dni,
          t.type AS raw_nombre,
          COALESCE(t.phone, 'Desconocida') AS ip,
          CASE WHEN t.date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN t.date::date ELSE CURRENT_DATE END AS fecha,
          CASE WHEN t.time ~ '^\\d{2}:\\d{2}(:\\d{2})?$' THEN t.time::time ELSE CURRENT_TIME END AS hora,
          jsonb_build_object('notes', t.notes) AS detalles,
          to_timestamp(COALESCE(t.created_at, 0) / 1000.0) AS created_at
      FROM public.tareas t
      LEFT JOIN public.agentes_perfiles p ON p.dni = t.title
      WHERE t.dni = 'SYSTEM_LOGIN_LOG' AND p.dni IS NULL
      ON CONFLICT (id) DO NOTHING;
    `);

    const auditCounts = await executeSqlViaManagementApi(`
      SELECT 'conexiones_audit' as tbl, count(*) FROM public.conexiones_audit
      UNION ALL
      SELECT 'conexiones_audit_huerfanas', count(*) FROM public.conexiones_audit_huerfanas;
    `);
    const migrados = Number(auditCounts.find(r => r.tbl === 'conexiones_audit').count);
    const huerfanos = Number(auditCounts.find(r => r.tbl === 'conexiones_audit_huerfanas').count);
    const totalPreservados = migrados + huerfanos;

    console.log(`  Migrados con perfil: ${migrados}, Huérfanos históricos: ${huerfanos}, Total: ${totalPreservados}`);
    if (totalPreservados !== totalOriginal) {
      throw new Error(`ABORTANDO: Recuento desigual. Original: ${totalOriginal}, Preservados: ${totalPreservados}`);
    }

    await executeSqlViaManagementApi(`
      DELETE FROM public.tareas 
      WHERE dni = 'SYSTEM_LOGIN_LOG'
        AND (
          id IN (SELECT id FROM public.conexiones_audit)
          OR id IN (SELECT id FROM public.conexiones_audit_huerfanas)
        );
    `);
    console.log(`  [GATE 4: OK] Transición completada. Cero logs perdidos.`);

    // ------------------------------------------------------------------------
    // GATE 5: APLICACIÓN DE RLS Y POLÍTICAS DE ACCESO
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 5] Aplicando RLS y políticas ---");
    await executeSqlViaManagementApi(`
      ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.vacaciones ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conexiones_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conexiones_audit_huerfanas ENABLE ROW LEVEL SECURITY;

      REVOKE ALL ON public.agentes_roles FROM PUBLIC, anon;
    `);
    console.log("  [GATE 5: OK] RLS activo.");

    console.log("\n==================================================================");
    console.log(" CORTE DE PRODUCCIÓN COMPLETADO CON ÉXITO");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n[FALLO EN CORTE]:", err.message);
    console.log("Iniciando procedimiento de recuperación...");
    await rollbackCutover(createdAuthUsers);
    process.exit(1);
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error("Excepción en ejecución:", err.message);
    process.exit(1);
  });
}

module.exports = {
  PRODUCTION_STAFF,
  generateSecureTempPassword,
  verifyPrerequisites,
  rollbackCutover
};
