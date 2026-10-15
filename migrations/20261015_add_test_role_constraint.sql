-- ============================================================================
-- MIGRACIÓN: AMPLIACIÓN DE RESTRICCIÓN DE CHECK PARA ROL 'test'
-- Archivo: migrations/20261015_add_test_role_constraint.sql
-- ============================================================================
-- Permite asignar el nuevo rol 'test' a perfiles y cuentas de pruebas
-- para su correcta catalogación y ordenación separada en Gestión de Usuarios.
-- ============================================================================

ALTER TABLE public.agentes_perfiles DROP CONSTRAINT IF EXISTS agentes_perfiles_rol_check;
ALTER TABLE public.agentes_perfiles ADD CONSTRAINT agentes_perfiles_rol_check 
    CHECK (rol IN ('gerente', 'comercial', 'evaria', 'test'));
