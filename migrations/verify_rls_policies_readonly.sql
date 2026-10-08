-- ============================================================================
-- SCRIPT DE INSPECCIÓN DE POLÍTICAS RLS Y PERMISOS (SOLO LECTURA)
-- Base de datos: Supabase (PostgreSQL)
-- Objetivo: Verificar el estado real de Row Level Security (RLS) y privilegios
-- ============================================================================

-- 1. Comprobar si las tablas del Asistente Comercial tienen RLS activado
SELECT 
    schemaname, 
    tablename, 
    rowsecurity AS rls_activado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('agentes_roles', 'tareas', 'vacaciones', 'promociones', 'conexiones_audit', 'agentes_perfiles')
ORDER BY tablename;

-- 2. Inspeccionar todas las políticas RLS existentes en el esquema public
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual AS definicion_using, 
    with_check AS definicion_with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Comprobar permisos efectivos otorgados a los roles 'anon' y 'authenticated'
SELECT 
    grantee, 
    table_schema, 
    table_name, 
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('agentes_roles', 'tareas', 'vacaciones', 'promociones')
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY table_name, grantee, privilege_type;

-- 4. Inspeccionar funciones del esquema public (verificar si hay funciones SECURITY DEFINER y su search_path)
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    CASE WHEN p.secdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_type,
    p.proconfig AS configuration_settings
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;
