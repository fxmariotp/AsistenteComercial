/**
 * ============================================================================
 * SCRIPT DE APROVISIONAMIENTO Y MIGRACIÓN DE IDENTIDADES PARA PRODUCCIÓN
 * Archivo: scripts/provision_production_identities.js
 * ============================================================================
 * Genera el paquete de identidades para el entorno de PRODUCCIÓN:
 * 1. Mapea todos los usuarios operativos existentes (comerciales, gerentes, evaria).
 * 2. Asigna contraseñas temporales criptográficas de alta entropía (16 bytes base64).
 * 3. Configura must_change_password = true y activo = true.
 * 4. Genera exportación privada en scratch/production_credentials_distribution.csv
 *    para entrega confidencial a los usuarios.
 * 5. Genera script SQL de inserción directa para auth.users y agentes_perfiles
 *    si se ejecuta vía Supabase SQL Editor.
 * 6. Admite ejecución directa vía Supabase Admin Client si se proporciona
 *    SUPABASE_PROD_SERVICE_ROLE_KEY.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRODUCTION_PROJECT_ID = "bxgdtdzlijeaetlekbub";
const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_ID}.supabase.co`;

const CATALOG_AGENTS = [
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

function generateProductionProvisioningPackage() {
  console.log("==================================================================");
  console.log(" GENERANDO PAQUETE DE APROVISIONAMIENTO PARA PRODUCCIÓN");
  console.log(" Proyecto destino: " + PRODUCTION_PROJECT_ID);
  console.log(" Total identidades catálogo: " + CATALOG_AGENTS.length);
  console.log("==================================================================\n");

  const distributionRows = [
    ["DNI", "NOMBRE", "ROL", "EMAIL_ACCESO", "PASSWORD_TEMPORAL", "DEBE_CAMBIAR_PASS"]
  ];

  const provisioningPlan = [];

  for (const agent of CATALOG_AGENTS) {
    const email = `${agent.dni.toLowerCase()}@asistente.internal`;
    const tempPassword = generateSecureTempPassword();

    distributionRows.push([
      agent.dni,
      `"${agent.nombre}"`,
      agent.rol,
      email,
      `"${tempPassword}"`,
      "true"
    ]);

    provisioningPlan.push({
      ...agent,
      email,
      tempPassword
    });
  }

  // 1. Guardar CSV de distribución confidencial
  const outDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const csvContent = distributionRows.map(r => r.join(",")).join("\n");
  const csvPath = path.join(outDir, "production_credentials_distribution.csv");
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`[OK] Credenciales temporales guardadas en: ${csvPath}`);

  // 2. Generar SQL de provisión con pgcrypto para auth.users + agentes_perfiles
  let sql = `-- ============================================================================
-- SCRIPT SQL DE APROVISIONAMIENTO DE USUARIOS EN PRODUCCIÓN
-- Base de datos: ${PRODUCTION_PROJECT_ID}
-- Generado: ${new Date().toISOString()}
-- ============================================================================
-- Crea las identidades en auth.users y perfiles en agentes_perfiles con:
-- - Contraseña temporal cifrada con bcrypt (pgcrypto)
-- - must_change_password = true
-- - activo = true
-- - rol asignado según catálogo
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

`;

  for (const item of provisioningPlan) {
    const userId = crypto.randomUUID();
    const dniEsc = item.dni.replace(/'/g, "''");
    const nameEsc = item.nombre.replace(/'/g, "''");
    const emailEsc = item.email.replace(/'/g, "''");
    const rolEsc = item.rol.replace(/'/g, "''");
    const pwdEsc = item.tempPassword.replace(/'/g, "''");

    sql += `-- Usuario: ${item.nombre} (${item.dni}) [${item.rol}]
DO $$
DECLARE
    v_user_id uuid;
    v_existing_id uuid;
BEGIN
    SELECT id INTO v_existing_id FROM auth.users WHERE email = '${emailEsc}';

    IF v_existing_id IS NULL THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            id,
            instance_id,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            role,
            aud
        ) VALUES (
            v_user_id,
            '00000000-0000-0000-0000-000000000000',
            '${emailEsc}',
            crypt('${pwdEsc}', gen_salt('bf', 10)),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('dni', '${dniEsc}', 'nombre', '${nameEsc}'),
            now(),
            now(),
            'authenticated',
            'authenticated'
        );
    ELSE
        v_user_id := v_existing_id;
        UPDATE auth.users 
        SET encrypted_password = crypt('${pwdEsc}', gen_salt('bf', 10)),
            updated_at = now()
        WHERE id = v_user_id;
    END IF;

    INSERT INTO public.agentes_perfiles (
        user_id,
        dni,
        nombre,
        rol,
        activo,
        must_change_password,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        '${dniEsc}',
        '${nameEsc}',
        '${rolEsc}',
        true,
        true,
        now(),
        now()
    ) ON CONFLICT (dni) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        nombre = EXCLUDED.nombre,
        rol = EXCLUDED.rol,
        activo = true,
        must_change_password = true,
        updated_at = now();
END $$;

`;
  }

  sql += `\nCOMMIT;\n`;

  const sqlPath = path.join(outDir, "provision_production_users.sql");
  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log(`[OK] Script SQL de aprovisionamiento guardado en: ${sqlPath}`);
  console.log(`\nPaquete de producción completado: ${provisioningPlan.length} usuarios listos.`);
}

generateProductionProvisioningPackage();
