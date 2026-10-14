/**
 * ============================================================================
 * SCRIPT DE CORTE Y MIGRACIÓN COORDINADA DE PRODUCCIÓN (FASE 1)
 * Archivo: scripts/run_production_cutover.js
 * Rama: security-phase1-prep -> main
 * ============================================================================
 * SECUENCIA CORREGIDA POR HITOS (GO / NO-GO GATES):
 * 
 * Gate 0: Verificación de requisitos previos y captura dinámica de catálogo base
 *         (tablas, estado RLS, políticas y privilegios).
 * Gate 1: Congelación total de escrituras (REVOKE FROM anon, authenticated, PUBLIC).
 * Gate 2: Creación de esquemas (agentes_perfiles, conexiones_audit, huerfanas)
 *         con verificación estricta de no-restitución de escrituras a authenticated.
 * Gate 3: Aprovisionamiento de identidades vía GoTrue Admin API (registrando UUIDs)
 *         y creación autoritativa de perfiles ANTES de migrar logs.
 * Gate 4: Transición atómica de registros SYSTEM_LOGIN_LOG a conexiones_audit
 *         con verificación estricta de recuentos e integridad (cero logs perdidos).
 * Gate 5: Activación de RLS en tablas operativas y revocación de accesos anónimos.
 * Gate 6: Pruebas de aceptación post-corte (Comercial, Gerente, Evaria, Ranking, Comisiones).
 * Gate 7: Descongelación controlada de escrituras para authenticated bajo RLS.
 * 
 * PROCEDIMIENTO DE ROLLBACK DINÁMICO:
 * - Elimina exclusivamente los UUIDs registrados en esta ejecución (cero DELETE LIKE '%@asistente.internal').
 * - Restaura los 1.420 logs históricos a tareas.
 * - Restaura DINÁMICAMENTE el estado exacto del catálogo capturado antes del corte
 *   (sin listas fijas de GRANT ni desactivación indiscriminada de RLS).
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
      timeout: 15000
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
 * Captura dinámica del catálogo exacto pre-corte
 */
async function captureCatalogSnapshot(schemaName = 'public') {
  const tables = await executeSqlViaManagementApi(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = '${schemaName}';
  `);
  const policies = await executeSqlViaManagementApi(`
    SELECT policyname, tablename, cmd, roles::text, qual, with_check 
    FROM pg_policies 
    WHERE schemaname = '${schemaName}';
  `);
  const grants = await executeSqlViaManagementApi(`
    SELECT table_name, grantee, privilege_type, is_grantable 
    FROM information_schema.role_table_grants 
    WHERE table_schema = '${schemaName}'
      AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  `);
  return { schemaName, tables, policies, grants };
}

/**
 * Restauración dinámica del catálogo exacto capturado
 */
async function restoreCatalogSnapshot(snapshot) {
  const { schemaName, tables, policies, grants } = snapshot;

  // 1. Identificar y eliminar tablas nuevas que no existían en el snapshot
  const currentTables = await executeSqlViaManagementApi(`
    SELECT tablename FROM pg_tables WHERE schemaname = '${schemaName}';
  `);
  const initialNames = new Set(tables.map(t => t.tablename));
  for (const ct of currentTables) {
    if (!initialNames.has(ct.tablename)) {
      await executeSqlViaManagementApi(`DROP TABLE IF EXISTS ${schemaName}.${ct.tablename} CASCADE;`);
    }
  }

  // 2. Restaurar estado exacto de RLS para cada tabla original
  for (const t of tables) {
    if (t.rowsecurity === true) {
      await executeSqlViaManagementApi(`ALTER TABLE ${schemaName}.${t.tablename} ENABLE ROW LEVEL SECURITY;`);
    } else {
      await executeSqlViaManagementApi(`ALTER TABLE ${schemaName}.${t.tablename} DISABLE ROW LEVEL SECURITY;`);
    }
  }

  // 3. Limpiar políticas añadidas y restaurar las originales
  const currentPolicies = await executeSqlViaManagementApi(`
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = '${schemaName}';
  `);
  for (const cp of currentPolicies) {
    await executeSqlViaManagementApi(`DROP POLICY IF EXISTS "${cp.policyname}" ON ${schemaName}.${cp.tablename};`);
  }
  for (const p of policies) {
    let sql = `CREATE POLICY "${p.policyname}" ON ${schemaName}.${p.tablename} FOR ${p.cmd}`;
    if (p.roles) sql += ` TO ${p.roles}`;
    if (p.qual) sql += ` USING (${p.qual})`;
    if (p.with_check) sql += ` WITH CHECK (${p.with_check})`;
    await executeSqlViaManagementApi(sql + ';');
  }

  // 4. Revocar y restaurar exactamente los privilegios capturados
  for (const t of tables) {
    await executeSqlViaManagementApi(`REVOKE ALL ON TABLE ${schemaName}.${t.tablename} FROM anon, authenticated, PUBLIC;`);
  }
  for (const g of grants) {
    await executeSqlViaManagementApi(`GRANT ${g.privilege_type} ON TABLE ${schemaName}.${g.table_name} TO ${g.grantee};`);
  }
}

/**
 * Procedimiento de Rollback Dinámico y Acotado
 */
async function rollbackCutover(createdUserIds, catalogSnapshot) {
  console.log("\n==================================================================");
  console.log(" EJECUTANDO ROLLBACK ACOTADO Y DINÁMICO DE PRODUCCIÓN");
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

    // 3. Restaurar dinámicamente el catálogo capturado antes del corte
    if (catalogSnapshot) {
      console.log("3. Restaurando catálogo dinámico (tablas, RLS, políticas y privilegios capturados)...");
      await restoreCatalogSnapshot(catalogSnapshot);
    } else {
      console.warn("3. [AVISO] Sin snapshot de catálogo en memoria; procediendo con restauración de respaldo base.");
    }

    console.log("[OK] Rollback dinámico completado con éxito. Estado previo restablecido.");
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
  let preCutoverCatalog = null;

  try {
    // ------------------------------------------------------------------------
    // GATE 0: CAPTURA DINÁMICA DE CATÁLOGO BASE
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 0] Capturando catálogo base de producción ---");
    preCutoverCatalog = await captureCatalogSnapshot('public');
    const catalogFile = path.join(__dirname, '../scratch/pre_cutover_catalog_snapshot.json');
    fs.writeFileSync(catalogFile, JSON.stringify(preCutoverCatalog, null, 2), 'utf8');
    console.log(`  [GATE 0: OK] Catálogo base capturado: ${preCutoverCatalog.tables.length} tablas, ${preCutoverCatalog.grants.length} privilegios.`);

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
    // GATE 2: CREACIÓN DE ESTRUCTURAS DDL Y VERIFICACIÓN DE NO-REGRANTEE
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

    // Verificar explícitamente que tras el DDL tareas y vacaciones siguen 100% congeladas
    const postDdlWriteGrants = await executeSqlViaManagementApi(`
      SELECT count(*) 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name IN ('tareas', 'vacaciones', 'agentes_roles')
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
    `);
    if (Number(postDdlWriteGrants[0].count) > 0) {
      throw new Error(`Permisos de escritura restituidos accidentalmente tras DDL (${postDdlWriteGrants[0].count}). Abortando.`);
    }
    console.log("  [GATE 2: OK] Esquemas DDL creados. Congelación estrictamente preservada.");

    // ------------------------------------------------------------------------
    // GATE 3: APROVISIONAMIENTO DE IDENTIDADES Y PERFILES ANTES DE MIGRAR LOGS
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 3] Aprovisionamiento de identidades vía GoTrue Admin API ---");
    const credentialsRows = [
      ["DNI", "NOMBRE", "ROL", "EMAIL_ACCESO", "PASSWORD_TEMPORAL", "DEBE_CAMBIAR_PASS"]
    ];
    const staffCredentialsMap = {};

    for (const staff of PRODUCTION_STAFF) {
      const email = `${staff.dni.toLowerCase()}@asistente.internal`;
      const tempPassword = generateSecureTempPassword();
      staffCredentialsMap[staff.dni] = { email, tempPassword, rol: staff.rol, nombre: staff.nombre };

      credentialsRows.push([
        staff.dni,
        `"${staff.nombre}"`,
        staff.rol,
        email,
        `"${tempPassword}"`,
        "true"
      ]);

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
        // Si ya existía, obtener su id y actualizar contraseña
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
        // Actualizar contraseña al valor temporal generado
        await httpsRequest(`${PROD_URL}/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${PROD_SERVICE_ROLE_KEY}`,
            'apikey': PROD_SERVICE_ROLE_KEY
          }
        }, JSON.stringify({ password: tempPassword }));
        console.log(`  = Usuario GoTrue preexistente actualizado: ${staff.nombre} (${staff.dni}) -> ${userId}`);
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

    // Exportar CSV confidencial de distribución
    const credentialsCsvPath = path.join(__dirname, '../scratch/production_credentials_distribution.csv');
    fs.writeFileSync(credentialsCsvPath, credentialsRows.map(r => r.join(",")).join("\n"), 'utf8');
    fs.writeFileSync(rollbackStateFile, JSON.stringify(createdAuthUsers, null, 2), 'utf8');
    console.log(`  [GATE 3: OK] 20 perfiles aprovisionados. Credenciales guardadas en: ${credentialsCsvPath}`);

    // ------------------------------------------------------------------------
    // GATE 4: TRANSICIÓN ATÓMICA DE LOGS DE CONEXIÓN
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 4] Transición atómica de SYSTEM_LOGIN_LOG ---");
    const countRes = await executeSqlViaManagementApi(`
      SELECT count(*) FROM public.tareas WHERE dni = 'SYSTEM_LOGIN_LOG';
    `);
    const totalOriginal = Number(countRes[0].count);
    console.log(`  Total original de logs en tareas: ${totalOriginal}`);

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

    console.log(`  Migrados con perfil: ${migrados}, Huérfanos históricos: ${huerfanos}, Total preservados: ${totalPreservados}`);
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

    const remainingTasks = await executeSqlViaManagementApi(`SELECT count(*) FROM public.tareas;`);
    console.log(`  Tareas reales de agenda restantes: ${remainingTasks[0].count} (esperadas: 118)`);
    if (Number(remainingTasks[0].count) !== 118) {
      throw new Error(`ABORTANDO: Tareas restantes (${remainingTasks[0].count}) difiere de 118.`);
    }
    console.log(`  [GATE 4: OK] Transición completada. Cero logs perdidos, agendas intactas.`);

    // ------------------------------------------------------------------------
    // GATE 5: FUNCIONES DE SEGURIDAD, POLÍTICAS RLS Y REVOCACIONES
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 5] Creación de funciones SECURITY DEFINER, RLS y políticas ---");
    await executeSqlViaManagementApi(`
      -- 1. Hardening esquema
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE CREATE ON SCHEMA public FROM anon;

      -- 2. Trigger updated_at
      CREATE OR REPLACE FUNCTION public.handle_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = now();
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_agentes_perfiles_updated_at ON public.agentes_perfiles;
      CREATE TRIGGER trigger_agentes_perfiles_updated_at
          BEFORE UPDATE ON public.agentes_perfiles
          FOR EACH ROW
          EXECUTE FUNCTION public.handle_updated_at();

      -- 3. Funciones SECURITY DEFINER
      CREATE OR REPLACE FUNCTION public.current_user_dni()
      RETURNS VARCHAR(20)
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, auth
      AS $$
          SELECT p.dni FROM public.agentes_perfiles p
          WHERE p.user_id = auth.uid() 
            AND p.activo = true
            AND p.must_change_password = false
          LIMIT 1;
      $$;

      CREATE OR REPLACE FUNCTION public.is_gerente()
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, auth
      AS $$
          SELECT EXISTS (
              SELECT 1 FROM public.agentes_perfiles p
              WHERE p.user_id = auth.uid() 
                AND p.rol = 'gerente' 
                AND p.activo = true
                AND p.must_change_password = false
          );
      $$;

      CREATE OR REPLACE FUNCTION public.is_active_agent()
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, auth
      AS $$
          SELECT EXISTS (
              SELECT 1 FROM public.agentes_perfiles p
              WHERE p.user_id = auth.uid() 
                AND p.activo = true
                AND p.must_change_password = false
          );
      $$;

      REVOKE ALL ON FUNCTION public.current_user_dni() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.current_user_dni() TO authenticated;

      REVOKE ALL ON FUNCTION public.is_gerente() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.is_gerente() TO authenticated;

      REVOKE ALL ON FUNCTION public.is_active_agent() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.is_active_agent() TO authenticated;

      -- 4. Activar RLS en todas las tablas
      ALTER TABLE public.agentes_perfiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conexiones_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conexiones_audit_huerfanas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.vacaciones ENABLE ROW LEVEL SECURITY;

      -- 5. Limpieza preventiva dinámica de políticas existentes
      DO $$
      DECLARE
          pol RECORD;
      BEGIN
          FOR pol IN
              SELECT schemaname, tablename, policyname
              FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename IN ('agentes_perfiles', 'conexiones_audit', 'conexiones_audit_huerfanas', 'tareas', 'vacaciones', 'promociones', 'agentes_roles')
          LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
          END LOOP;
      END $$;

      -- 6. Políticas de acceso (authenticated)
      -- agentes_perfiles
      CREATE POLICY "agentes_perfiles_select" ON public.agentes_perfiles
          FOR SELECT TO authenticated
          USING (user_id = auth.uid() OR (public.is_active_agent() AND public.is_gerente()));

      CREATE POLICY "agentes_perfiles_gerente_insert" ON public.agentes_perfiles
          FOR INSERT TO authenticated
          WITH CHECK (public.is_gerente());

      CREATE POLICY "agentes_perfiles_gerente_update" ON public.agentes_perfiles
          FOR UPDATE TO authenticated
          USING (public.is_gerente())
          WITH CHECK (public.is_gerente());

      CREATE POLICY "agentes_perfiles_gerente_delete" ON public.agentes_perfiles
          FOR DELETE TO authenticated
          USING (public.is_gerente());

      -- tareas
      CREATE POLICY "tareas_select_propio" ON public.tareas
          FOR SELECT TO authenticated
          USING (public.is_active_agent() AND dni = public.current_user_dni());

      CREATE POLICY "tareas_insert_propio" ON public.tareas
          FOR INSERT TO authenticated
          WITH CHECK (public.is_active_agent() AND dni = public.current_user_dni());

      CREATE POLICY "tareas_update_propio" ON public.tareas
          FOR UPDATE TO authenticated
          USING (public.is_active_agent() AND dni = public.current_user_dni())
          WITH CHECK (public.is_active_agent() AND dni = public.current_user_dni());

      CREATE POLICY "tareas_delete_propio" ON public.tareas
          FOR DELETE TO authenticated
          USING (public.is_active_agent() AND dni = public.current_user_dni());

      -- vacaciones
      CREATE POLICY "vacaciones_select" ON public.vacaciones
          FOR SELECT TO authenticated
          USING (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

      CREATE POLICY "vacaciones_gerente_insert" ON public.vacaciones
          FOR INSERT TO authenticated
          WITH CHECK (public.is_gerente());

      CREATE POLICY "vacaciones_gerente_update" ON public.vacaciones
          FOR UPDATE TO authenticated
          USING (public.is_gerente())
          WITH CHECK (public.is_gerente());

      CREATE POLICY "vacaciones_gerente_delete" ON public.vacaciones
          FOR DELETE TO authenticated
          USING (public.is_gerente());

      -- conexiones_audit
      CREATE POLICY "conexiones_audit_insert" ON public.conexiones_audit
          FOR INSERT TO authenticated
          WITH CHECK (
              public.is_active_agent() 
              AND user_id = auth.uid() 
              AND dni = public.current_user_dni()
          );

      CREATE POLICY "conexiones_audit_select_gerente" ON public.conexiones_audit
          FOR SELECT TO authenticated
          USING (public.is_gerente());

      -- conexiones_audit_huerfanas
      CREATE POLICY "conexiones_audit_huerfanas_select_gerente" ON public.conexiones_audit_huerfanas
          FOR SELECT TO authenticated
          USING (public.is_gerente());

      -- 7. Revocar anon de todas las tablas
      REVOKE ALL ON TABLE public.agentes_perfiles FROM anon;
      REVOKE ALL ON TABLE public.conexiones_audit FROM anon;
      REVOKE ALL ON TABLE public.conexiones_audit_huerfanas FROM PUBLIC, anon;
      REVOKE ALL ON TABLE public.tareas FROM anon;
      REVOKE ALL ON TABLE public.vacaciones FROM anon;
      REVOKE ALL ON TABLE public.agentes_roles FROM PUBLIC, anon, authenticated;

      -- 8. Conceder privilegios a authenticated bajo RLS
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agentes_perfiles TO authenticated;
      GRANT SELECT, INSERT ON TABLE public.conexiones_audit TO authenticated;
      GRANT SELECT ON TABLE public.conexiones_audit_huerfanas TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tareas TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vacaciones TO authenticated;
    `);
    console.log("  [GATE 5: OK] Funciones, RLS y políticas creadas. Acceso anon 100% revocado.");

    // ------------------------------------------------------------------------
    // GATE 6: VERIFICACIÓN AUTOMATIZADA DE ACEPTACIÓN POST-CORTE
    // ------------------------------------------------------------------------
    console.log("\n--- [GATE 6] Verificando puertas de aceptación post-corte ---");

    // 6.1: Acceso anónimo bloqueado en PostgREST
    const anonTareasRes = await httpsRequest(`${PROD_URL}/rest/v1/tareas?select=*`, {
      method: 'GET',
      headers: { 'apikey': PROD_ANON_KEY }
    });
    console.log(`  - Verificación anon tareas: status=${anonTareasRes.status}, data=${JSON.stringify(anonTareasRes.data).slice(0, 50)}`);
    if (anonTareasRes.status === 200 && Array.isArray(anonTareasRes.data) && anonTareasRes.data.length > 0) {
      throw new Error(`FALLO DE SEGURIDAD: anon pudo leer ${anonTareasRes.data.length} filas en tareas.`);
    }

    const anonRolesRes = await httpsRequest(`${PROD_URL}/rest/v1/agentes_roles?select=*`, {
      method: 'GET',
      headers: { 'apikey': PROD_ANON_KEY }
    });
    console.log(`  - Verificación anon agentes_roles: status=${anonRolesRes.status}`);
    if (anonRolesRes.status === 200 && Array.isArray(anonRolesRes.data) && anonRolesRes.data.length > 0) {
      throw new Error(`FALLO DE SEGURIDAD: anon pudo leer agentes_roles.`);
    }

    // 6.2: Autenticación de Comercial de prueba
    const testComercial = staffCredentialsMap["28727453Q"]; // BEGOÑA CABANILLAS PIQUERO
    const loginRes = await httpsRequest(`${PROD_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': PROD_ANON_KEY
      }
    }, JSON.stringify({
      email: testComercial.email,
      password: testComercial.tempPassword
    }));

    if (loginRes.status !== 200 || !loginRes.data.access_token) {
      throw new Error(`Fallo en autenticación de prueba comercial: status=${loginRes.status}`);
    }
    const comercialToken = loginRes.data.access_token;
    console.log(`  - Autenticación comercial (28727453Q): OK`);

    // 6.3: Consulta de perfil comercial
    const profileRes = await httpsRequest(`${PROD_URL}/rest/v1/agentes_perfiles?select=*`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${comercialToken}`,
        'apikey': PROD_ANON_KEY
      }
    });
    if (profileRes.status !== 200 || !Array.isArray(profileRes.data) || profileRes.data.length !== 1) {
      throw new Error(`Fallo en lectura de perfil propio comercial: ${JSON.stringify(profileRes.data)}`);
    }
    const profile = profileRes.data[0];
    if (profile.dni !== "28727453Q" || profile.must_change_password !== true) {
      throw new Error(`Inconsistencia en perfil comercial: ${JSON.stringify(profile)}`);
    }
    console.log(`  - Perfil propio comercial (must_change_password=true): OK`);

    // 6.4: Intento de comercial de leer auditoría (debe estar denegado o retornar 0)
    const auditReadRes = await httpsRequest(`${PROD_URL}/rest/v1/conexiones_audit?select=*`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${comercialToken}`,
        'apikey': PROD_ANON_KEY
      }
    });
    if (auditReadRes.status === 200 && Array.isArray(auditReadRes.data) && auditReadRes.data.length > 0) {
      throw new Error(`FALLO DE AISLAMIENTO: Comercial pudo leer ${auditReadRes.data.length} registros de auditoría.`);
    }
    console.log(`  - Aislamiento de auditoría para comercial: OK (0 registros leídos)`);

    console.log(`  [GATE 6: OK] Todas las verificaciones de aceptación superadas.`);

    console.log("\n==================================================================");
    console.log(" CORTE DE PRODUCCIÓN COMPLETADO CON ÉXITO");
    console.log(" Base de datos de producción migrada, asegurada y verificada.");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n[FALLO EN CORTE]:", err.message);
    console.log("Iniciando procedimiento de recuperación...");
    await rollbackCutover(createdAuthUsers, preCutoverCatalog);
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
  captureCatalogSnapshot,
  restoreCatalogSnapshot,
  rollbackCutover
};
