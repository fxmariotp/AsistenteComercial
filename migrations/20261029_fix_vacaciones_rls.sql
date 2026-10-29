-- ============================================================================
-- MIGRACIÓN: CORRECCIÓN DE POLÍTICAS RLS EN TABLA VACACIONES
-- Archivo: migrations/20261029_fix_vacaciones_rls.sql
-- ============================================================================
-- Propósito:
-- Permite a comerciales gestionar sus propias vacaciones (dni = current_user_dni())
-- y a gerentes gestionar todas las vacaciones de los comerciales (is_gerente()),
-- resolviendo el error de violación de RLS (42501) al agregar o borrar vacaciones.
-- Regla de negocio: 26 días laborables por comercial.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vacaciones') THEN
        -- 1. SELECT (lectura propia o de gerencia)
        DROP POLICY IF EXISTS "vacaciones_select" ON public.vacaciones;
        CREATE POLICY "vacaciones_select" ON public.vacaciones
            FOR SELECT TO authenticated
            USING (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

        -- 2. INSERT (inserción propia o de gerencia)
        DROP POLICY IF EXISTS "vacaciones_gerente_insert" ON public.vacaciones;
        DROP POLICY IF EXISTS "vacaciones_insert" ON public.vacaciones;
        CREATE POLICY "vacaciones_insert" ON public.vacaciones
            FOR INSERT TO authenticated
            WITH CHECK (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

        -- 3. UPDATE (actualización propia o de gerencia)
        DROP POLICY IF EXISTS "vacaciones_gerente_update" ON public.vacaciones;
        DROP POLICY IF EXISTS "vacaciones_update" ON public.vacaciones;
        CREATE POLICY "vacaciones_update" ON public.vacaciones
            FOR UPDATE TO authenticated
            USING (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()))
            WITH CHECK (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

        -- 4. DELETE (borrado propio o de gerencia)
        DROP POLICY IF EXISTS "vacaciones_gerente_delete" ON public.vacaciones;
        DROP POLICY IF EXISTS "vacaciones_delete" ON public.vacaciones;
        CREATE POLICY "vacaciones_delete" ON public.vacaciones
            FOR DELETE TO authenticated
            USING (public.is_active_agent() AND (dni = public.current_user_dni() OR public.is_gerente()));

        -- Concesión de privilegios a authenticated
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vacaciones TO authenticated;
    END IF;
END $$;
