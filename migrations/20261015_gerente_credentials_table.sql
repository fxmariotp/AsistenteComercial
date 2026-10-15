-- ============================================================================
-- MIGRACIÓN: TABLA SEGURA DE CREDENCIALES TEMPORALES PARA GERENCIA
-- Archivo: migrations/20261015_gerente_credentials_table.sql
-- ============================================================================
-- Propósito:
-- Permite a los usuarios con rol de Gerencia consultar de forma segura y desocultar
-- las contraseñas temporales activas de los comerciales en Gestión de Usuarios,
-- protegiendo la tabla con Row Level Security (RLS) estricto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agentes_credenciales_temp (
    dni VARCHAR(50) PRIMARY KEY,
    temp_password VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.agentes_credenciales_temp IS 'Credenciales temporales de distribución para consulta exclusiva de gerencia';

-- Habilitar RLS obligatorio
ALTER TABLE public.agentes_credenciales_temp ENABLE ROW LEVEL SECURITY;

-- Revocación absoluta a roles públicos y anónimos
REVOKE ALL ON TABLE public.agentes_credenciales_temp FROM PUBLIC, anon;

-- Concesión de lectura a usuarios autenticados sujeta a política RLS
GRANT SELECT ON TABLE public.agentes_credenciales_temp TO authenticated;

-- Política RLS: Solo usuarios con rol de gerente y cuenta activa pueden leer
DROP POLICY IF EXISTS "gerente_select_temp_creds" ON public.agentes_credenciales_temp;
CREATE POLICY "gerente_select_temp_creds" ON public.agentes_credenciales_temp
    FOR SELECT TO authenticated
    USING (public.is_gerente());
