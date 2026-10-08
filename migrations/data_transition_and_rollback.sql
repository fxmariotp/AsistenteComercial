-- ============================================================================
-- PROCEDIMIENTO SEGURO DE TRANSICIÓN DE DATOS, MANTENIMIENTO Y RECUPERACIÓN
-- Archivo: migrations/data_transition_and_rollback.sql
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
--
-- PASO 2: Migrar registros históricos de conexión a conexiones_audit:
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

-- PASO 3: Una vez verificada la inserción, limpiar los logs de la tabla tareas:
DELETE FROM public.tareas WHERE dni = 'SYSTEM_LOGIN_LOG';

-- ----------------------------------------------------------------------------
-- PARTE B: RETIRADA DEFINITIVA DE CONTRASEÑAS EN CLARO Y CACHÉS
-- ----------------------------------------------------------------------------
-- 1. Respaldar agentes_roles en archivo offline cifrado para histórico de auditoría.
-- 2. Eliminar la tabla agentes_roles en producción:
DROP TABLE IF EXISTS public.agentes_roles CASCADE;

-- 3. Limpieza forzada en clientes:
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
