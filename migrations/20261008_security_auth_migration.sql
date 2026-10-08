-- ============================================================================
-- MIGRACIÓN DE SEGURIDAD Y AUTENTICACIÓN - ASISTENTE COMERCIAL (FASE 1 REVISADA)
-- Archivo: migrations/20261008_security_auth_migration.sql
-- Rama de trabajo: security-phase1-prep
-- 
-- REGLA DE NEGOCIO CONFIRMADA POR DIRECCIÓN:
-- El cupo anual de vacaciones de Comerciales Renosur es de 26 días laborables.
-- (Regla documentada en el modelo de seguridad; sin alteración de saldos en Fase 1).
-- 
-- ORDEN ESTRICTO DE EJECUCIÓN (Anti-ventanas de exposición y cero interrupción):
-- 1. Hardening de esquemas (revocar CREATE a public).
-- 2. Creación de tablas de soporte (agentes_perfiles, conexiones_audit).
-- 3. Funciones SECURITY DEFINER protegidas y permisos de ejecución.
-- 4. Aprovisionamiento previo de identidades en auth.users y perfiles.
-- 5. Activación de RLS con políticas de mínimo privilegio (USING + WITH CHECK).
-- 6. Revocación absoluta de accesos al rol anónimo (anon).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. HARDENING DEL ESQUEMA PÚBLICO
-- ----------------------------------------------------------------------------
-- Impide que usuarios sin privilegios creen o reemplacen objetos en public
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;

-- ----------------------------------------------------------------------------
-- 2. TABLA DE PERFILES DE AGENTE (Vinculada a auth.users de Supabase)
-- ----------------------------------------------------------------------------
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

-- Si la tabla ya existía, asegurar la columna must_change_password
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'agentes_perfiles' 
          AND column_name = 'must_change_password'
    ) THEN
        ALTER TABLE public.agentes_perfiles ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT true;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'agentes_perfiles' 
          AND column_name = 'password_changed_at'
    ) THEN
        ALTER TABLE public.agentes_perfiles ADD COLUMN password_changed_at TIMESTAMPTZ;
    END IF;
END $$;

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_agentes_perfiles_user_id ON public.agentes_perfiles(user_id);
CREATE INDEX IF NOT EXISTS idx_agentes_perfiles_dni ON public.agentes_perfiles(dni);

-- Trigger de updated_at
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

-- ----------------------------------------------------------------------------
-- 3. TABLA DEDICADA DE AUDITORÍA DE CONEXIONES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conexiones_audit (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dni VARCHAR(20) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    ip VARCHAR(50) NOT NULL DEFAULT 'Desconocida',
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    hora TIME NOT NULL DEFAULT CURRENT_TIME,
    detalles JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conexiones_audit_dni ON public.conexiones_audit(dni);
CREATE INDEX IF NOT EXISTS idx_conexiones_audit_fecha ON public.conexiones_audit(fecha);

-- ----------------------------------------------------------------------------
-- 4. FUNCIONES DE SEGURIDAD (SECURITY DEFINER con search_path blindado)
-- ----------------------------------------------------------------------------
-- Fuente de autoridad 100% en public.agentes_perfiles (NO depende de user_metadata)

-- Devuelve el DNI del usuario autenticado actual a partir de su auth.uid() si está activo y al día
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

-- Comprueba si el usuario autenticado tiene rol 'gerente' activo y sin cambio pendiente
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

-- Comprueba si el usuario autenticado es un agente activo sin cambio pendiente
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

-- Limpieza preventiva: NO se añaden triggers sobre auth.users para evitar incompatibilidades con Supabase Auth
DROP TRIGGER IF EXISTS trigger_enforce_password_change ON auth.users;
DROP FUNCTION IF EXISTS public.enforce_password_change_on_unlock();

-- Restringir permisos de ejecución en funciones de seguridad
REVOKE ALL ON FUNCTION public.current_user_dni() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_dni() TO authenticated;

REVOKE ALL ON FUNCTION public.is_gerente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gerente() TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_agent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_agent() TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. ACTIVACIÓN DE ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.agentes_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conexiones_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tareas') THEN
        ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vacaciones') THEN
        ALTER TABLE public.vacaciones ENABLE ROW LEVEL SECURITY;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'promociones') THEN
        ALTER TABLE public.promociones ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. POLÍTICAS DE ACCESO DE MÍNIMO PRIVILEGIO (authenticated)
-- Limpieza preventiva dinámica de cualquier política previa en pg_policies
-- para impedir que sobrevivan reglas permisivas desconocidas
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('agentes_perfiles', 'conexiones_audit', 'tareas', 'vacaciones', 'promociones', 'agentes_roles')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- Políticas en agentes_perfiles
CREATE POLICY "agentes_perfiles_select" ON public.agentes_perfiles
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR (public.is_active_agent() AND public.is_gerente()));

CREATE POLICY "agentes_perfiles_gerente_insert" ON public.agentes_perfiles
    FOR INSERT TO authenticated
    WITH CHECK (public.is_gerente());

-- UPDATE valida tanto la fila original (USING) como los nuevos valores (WITH CHECK)
CREATE POLICY "agentes_perfiles_gerente_update" ON public.agentes_perfiles
    FOR UPDATE TO authenticated
    USING (public.is_gerente())
    WITH CHECK (public.is_gerente());

CREATE POLICY "agentes_perfiles_gerente_delete" ON public.agentes_perfiles
    FOR DELETE TO authenticated
    USING (public.is_gerente());

-- Políticas en tareas (Aislamiento absoluto de la agenda comercial propia)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tareas') THEN
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
    END IF;
END $$;

-- Políticas en vacaciones (Control gerencial y lectura individual)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vacaciones') THEN
        DROP POLICY IF EXISTS "vacaciones_select" ON public.vacaciones;
        CREATE POLICY "vacaciones_select" ON public.vacaciones
            FOR SELECT TO authenticated
            USING (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

        DROP POLICY IF EXISTS "vacaciones_gerente_insert" ON public.vacaciones;
        CREATE POLICY "vacaciones_gerente_insert" ON public.vacaciones
            FOR INSERT TO authenticated
            WITH CHECK (public.is_gerente());

        DROP POLICY IF EXISTS "vacaciones_gerente_update" ON public.vacaciones;
        CREATE POLICY "vacaciones_gerente_update" ON public.vacaciones
            FOR UPDATE TO authenticated
            USING (public.is_gerente())
            WITH CHECK (public.is_gerente());

        DROP POLICY IF EXISTS "vacaciones_gerente_delete" ON public.vacaciones;
        CREATE POLICY "vacaciones_gerente_delete" ON public.vacaciones
            FOR DELETE TO authenticated
            USING (public.is_gerente());
    END IF;
END $$;

-- Políticas en conexiones_audit
-- La identidad se vincula inexorablemente a auth.uid() y current_user_dni()
DROP POLICY IF EXISTS "conexiones_audit_insert" ON public.conexiones_audit;
CREATE POLICY "conexiones_audit_insert" ON public.conexiones_audit
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_agent() 
        AND user_id = auth.uid() 
        AND dni = public.current_user_dni()
    );

DROP POLICY IF EXISTS "conexiones_audit_select_gerente" ON public.conexiones_audit;
CREATE POLICY "conexiones_audit_select_gerente" ON public.conexiones_audit
    FOR SELECT TO authenticated
    USING (public.is_gerente());

-- NO se crean políticas de UPDATE ni DELETE en conexiones_audit (Inmutabilidad estricta de auditoría)

-- Políticas en promociones
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'promociones') THEN
        DROP POLICY IF EXISTS "promociones_select_activos" ON public.promociones;
        CREATE POLICY "promociones_select_activos" ON public.promociones
            FOR SELECT TO authenticated
            USING (public.is_active_agent());

        DROP POLICY IF EXISTS "promociones_write_gerente" ON public.promociones;
        CREATE POLICY "promociones_write_gerente" ON public.promociones
            FOR ALL TO authenticated
            USING (public.is_gerente())
            WITH CHECK (public.is_gerente());
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. REVOCAR ACCESO ANÓNIMO A TODAS LAS TABLAS DE DATOS
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.agentes_perfiles FROM anon;
REVOKE ALL ON TABLE public.conexiones_audit FROM anon;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tareas') THEN
        REVOKE ALL ON TABLE public.tareas FROM anon;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vacaciones') THEN
        REVOKE ALL ON TABLE public.vacaciones FROM anon;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'promociones') THEN
        REVOKE ALL ON TABLE public.promociones FROM anon;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agentes_roles') THEN
        REVOKE ALL ON TABLE public.agentes_roles FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Conceder permisos de ejecución sobre tablas a authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agentes_perfiles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.conexiones_audit TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tareas') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tareas TO authenticated;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vacaciones') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vacaciones TO authenticated;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'promociones') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promociones TO authenticated;
    END IF;
END $$;

COMMIT;
