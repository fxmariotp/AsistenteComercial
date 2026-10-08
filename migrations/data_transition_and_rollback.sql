-- ============================================================================
-- PROCEDIMIENTO SEGURO DE TRANSICIÓN DE DATOS, MANTENIMIENTO Y RECUPERACIÓN
-- Archivo: migrations/data_transition_and_rollback.sql
-- Rama de trabajo: security-phase1-prep
-- ============================================================================
-- REGLA DE NEGOCIO CONFIRMADA POR DIRECCIÓN:
-- El cupo anual de vacaciones de Comerciales Renosur es de 26 días laborables.
-- (Regla documentada en el modelo de seguridad; sin alteración de saldos en Fase 1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PARTE A: SECUENCIA ORDENADA DE TRANSICIÓN (ANTI-INTERRUPCIÓN Y ANTI-EXPOSICIÓN)
-- ----------------------------------------------------------------------------
-- Para evitar ventanas de exposición y caídas de servicio, la secuencia técnica es:
--
-- PASO 1 (Previo a RLS): Crear identidades en auth.users y filas en agentes_perfiles.
-- Mediante script Node.js administrativo ejecutado en servidor seguro (Service Role Key):
--
-- const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
-- const agentes = [
--   { dni: '47269867Z', nombre: 'CHRISTIAN CABRERA MARQUEZ', rol: 'comercial' },
--   ...
-- ];
-- for (const a of agentes) {
--   const email = `${a.dni.toLowerCase()}@asistente.internal`;
--   const tempPassword = crypto.randomBytes(24).toString('base64');
--   
--   // Crear identidad en Supabase Auth
--   const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
--     email,
--     password: tempPassword,
--     email_confirm: true,
--     user_metadata: {
--       dni: a.dni,
--       nombre: a.nombre
--     }
--   });
--   
--   // Crear perfil autoritativo en base de datos con must_change_password = true
--   if (authUser && authUser.user) {
--     await adminClient.from('agentes_perfiles').upsert({
--       user_id: authUser.user.id,
--       dni: a.dni,
--       nombre: a.nombre,
--       rol: a.rol,
--       activo: true,
--       must_change_password: true // Estado controlado por el servidor
--     });
--   }
-- }

-- PASO 2: Tabla dedicada para preservar registros de conexión huérfanos
-- (Evita cualquier pérdida de logs antiguos cuyos DNI no coincidan con perfiles activos)
CREATE TABLE IF NOT EXISTS public.conexiones_audit_huerfanas (
    id VARCHAR(100) PRIMARY KEY,
    raw_dni VARCHAR(50),
    raw_nombre VARCHAR(150),
    ip VARCHAR(50),
    fecha DATE,
    hora TIME,
    detalles JSONB,
    created_at TIMESTAMPTZ,
    motivo_orfandad TEXT DEFAULT 'Sin perfil asociado en agentes_perfiles al momento de la migración',
    migrated_at TIMESTAMPTZ DEFAULT now()
);

-- Hardening y RLS en conexiones_audit_huerfanas desde su creación
ALTER TABLE public.conexiones_audit_huerfanas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conexiones_audit_huerfanas FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.conexiones_audit_huerfanas TO authenticated;

-- RLS: Exclusivamente gerentes activos pueden consultar registros huérfanos
DROP POLICY IF EXISTS "conexiones_audit_huerfanas_select_gerente" ON public.conexiones_audit_huerfanas;
CREATE POLICY "conexiones_audit_huerfanas_select_gerente" ON public.conexiones_audit_huerfanas
    FOR SELECT TO authenticated
    USING (public.is_gerente());

-- CERO políticas de INSERT, UPDATE o DELETE para usuarios (inmutabilidad estricta)

-- PASO 3: Transacción atómica protegida con verificación estricta de recuentos e integridad
DO $$
DECLARE
    v_total_original INT := 0;
    v_total_migrados INT := 0;
    v_total_huerfanos INT := 0;
    v_total_preservados INT := 0;
BEGIN
    -- 1. Recuento inicial exacto de registros SYSTEM_LOGIN_LOG en tareas
    SELECT COUNT(*) INTO v_total_original 
    FROM public.tareas 
    WHERE dni = 'SYSTEM_LOGIN_LOG';

    RAISE NOTICE 'Registros originales SYSTEM_LOGIN_LOG detectados: %', v_total_original;

    IF v_total_original > 0 THEN
        -- 2. Migrar registros que coinciden con agentes_perfiles a conexiones_audit
        INSERT INTO public.conexiones_audit (id, user_id, dni, nombre, ip, fecha, hora, detalles, created_at)
        SELECT 
            t.id,
            p.user_id,
            t.title AS dni,
            t.type AS nombre,
            COALESCE(t.phone, 'Desconocida') AS ip,
            CASE 
                WHEN t.date ~ '^\d{4}-\d{2}-\d{2}$' THEN t.date::date 
                ELSE CURRENT_DATE 
            END AS fecha,
            CASE 
                WHEN t.time ~ '^\d{2}:\d{2}(:\d{2})?$' THEN t.time::time 
                ELSE CURRENT_TIME 
            END AS hora,
            jsonb_build_object('notes', t.notes) AS detalles,
            to_timestamp(COALESCE(t.created_at, 0) / 1000.0) AS created_at
        FROM public.tareas t
        JOIN public.agentes_perfiles p ON p.dni = t.title
        WHERE t.dni = 'SYSTEM_LOGIN_LOG'
        ON CONFLICT (id) DO NOTHING;

        -- 3. Identificar y preservar registros huérfanos (sin perfil coincidente)
        INSERT INTO public.conexiones_audit_huerfanas (id, raw_dni, raw_nombre, ip, fecha, hora, detalles, created_at)
        SELECT 
            t.id,
            t.title AS raw_dni,
            t.type AS raw_nombre,
            COALESCE(t.phone, 'Desconocida') AS ip,
            CASE 
                WHEN t.date ~ '^\d{4}-\d{2}-\d{2}$' THEN t.date::date 
                ELSE CURRENT_DATE 
            END AS fecha,
            CASE 
                WHEN t.time ~ '^\d{2}:\d{2}(:\d{2})?$' THEN t.time::time 
                ELSE CURRENT_TIME 
            END AS hora,
            jsonb_build_object('notes', t.notes) AS detalles,
            to_timestamp(COALESCE(t.created_at, 0) / 1000.0) AS created_at
        FROM public.tareas t
        LEFT JOIN public.agentes_perfiles p ON p.dni = t.title
        WHERE t.dni = 'SYSTEM_LOGIN_LOG' AND p.dni IS NULL
        ON CONFLICT (id) DO NOTHING;

        -- 4. Verificación estricta de recuentos e identificadores antes de cualquier eliminación
        SELECT COUNT(*) INTO v_total_migrados
        FROM public.conexiones_audit ca
        WHERE ca.id IN (SELECT id FROM public.tareas WHERE dni = 'SYSTEM_LOGIN_LOG');

        SELECT COUNT(*) INTO v_total_huerfanos
        FROM public.conexiones_audit_huerfanas cah
        WHERE cah.id IN (SELECT id FROM public.tareas WHERE dni = 'SYSTEM_LOGIN_LOG');

        v_total_preservados := v_total_migrados + v_total_huerfanos;

        RAISE NOTICE 'Preservados en conexiones_audit: %, en conexiones_audit_huerfanas: %, Total: %',
            v_total_migrados, v_total_huerfanos, v_total_preservados;

        -- Si no se conservó el 100% de los identificadores, abortar la transacción de inmediato
        IF v_total_preservados < v_total_original THEN
            RAISE EXCEPTION 'ABORTANDO TRANSACCIÓN: Pérdida potencial de registros de conexión detectada. Total original: %, Total preservado: %', 
                v_total_original, v_total_preservados;
        END IF;

        -- 5. Eliminación atómica ÚNICAMENTE de los identificadores confirmados y respaldados
        DELETE FROM public.tareas 
        WHERE dni = 'SYSTEM_LOGIN_LOG'
          AND (
            id IN (SELECT id FROM public.conexiones_audit)
            OR id IN (SELECT id FROM public.conexiones_audit_huerfanas)
          );

        RAISE NOTICE 'Transición de auditoría completada con éxito. Cero registros huérfanos perdidos.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PARTE B: RETIRADA DEFINITIVA DE CONTRASEÑAS EN CLARO Y CACHÉS
-- ----------------------------------------------------------------------------
-- 1. INSPECCIÓN DE DEPENDENCIAS DE CATALOGO ANTES DE DROP TABLE:
-- Ejecutar esta consulta antes de DROP TABLE CASCADE para auditar vistas, funciones
-- o restricciones foráneas que hagan referencia a agentes_roles:
/*
SELECT 
    cl.relname AS tabla_dependiente,
    c.conname AS nombre_restriccion,
    c.contype AS tipo_restriccion
FROM pg_constraint c
JOIN pg_class cl ON cl.oid = c.conrelid
WHERE c.confrelid = 'public.agentes_roles'::regclass;
*/

-- 2. Respaldar agentes_roles en archivo offline cifrado para histórico de auditoría.
-- 3. Eliminar la tabla agentes_roles en producción:
DROP TABLE IF EXISTS public.agentes_roles CASCADE;

-- 4. Limpieza forzada en clientes:
-- El frontend ejecuta en el evento de inicio de sesión y arranque:
-- localStorage.removeItem('renosur_agent_roles');
-- localStorage.removeItem('cached_agent_passwords');
-- localStorage.removeItem('renosur_comisiones_cache');

-- ----------------------------------------------------------------------------
-- PARTE C: PROCEDIMIENTO DE RECUPERACIÓN SEGURO (SIN APERTURA ANÓNIMA NI SIN RLS)
-- ----------------------------------------------------------------------------
-- REGLA ESTRICTA DE SEGURIDAD:
-- BAJO NINGUNA CIRCUNSTANCIA SE PERMITE DESACTIVAR RLS NI REABRIR ACCESO ANÓNIMO
-- A DATOS PRIVADOS DURANTE UNA REVERSIÓN.
--
-- En caso de fallo crítico en la migración:
-- 1. ACTIVAR MODO MANTENIMIENTO:
--    Redirigir el tráfico en Vercel (Edge Config o middleware) hacia una página
--    estática de mantenimiento temporal: "Sistema en mantenimiento programado".
--
-- 2. RECUPERACIÓN CON PERMISOS RESTRINGIDOS:
--    Si se requiere acceso de emergencia de lectura para gerencia mientras se repara
--    el sistema, se mantendrán las políticas RLS activas y solo se permitirá acceso
--    mediante tokens de servicio o cuentas autenticadas de nivel administrador.
--
-- 3. INVALIDACIÓN DE CREDENCIALES ANTERIORES:
--    Dado que las contraseñas en claro anteriores pudieron haber sido extraídas
--    previamente del navegador, no es seguro restaurarlas.
--    Toda cuenta migrada requiere una nueva contraseña mediante Supabase Auth
--    (marcador must_change_password: true). Las sesiones anteriores quedan 100%
--    invalidadas al eliminarse la tabla agentes_roles y revocar los tokens.
