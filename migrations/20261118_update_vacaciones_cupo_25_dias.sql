-- ============================================================================
-- MIGRACIÓN: ACTUALIZACIÓN DE CUPO ANUAL DE VACACIONES A 25 DÍAS LABORABLES
-- Archivo: migrations/20261118_update_vacaciones_cupo_25_dias.sql
-- ============================================================================
-- REGLA DE NEGOCIO ACTUALIZADA (DIRECCIÓN - NOVIEMBRE 2026):
-- El cupo anual total de vacaciones de Comerciales Renosur es de 25 días laborables.
-- Se reduce en 1 día el cupo anterior (26 días -> 25 días).
-- ============================================================================

COMMENT ON TABLE public.vacaciones IS 'Días de vacaciones seleccionados por cada agente (límite comercial: 25 días laborables)';
