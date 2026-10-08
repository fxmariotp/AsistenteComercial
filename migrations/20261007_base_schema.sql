-- ============================================================================
-- ESQUEMA BASE DE DATOS OPERATIVOS (STAGING / ENTORNO LIMPIO)
-- Archivo: migrations/20261007_base_schema.sql
-- Rama de trabajo: security-phase1-prep
-- ============================================================================
-- REGLA DE NEGOCIO CONFIRMADA POR DIRECCIÓN:
-- El cupo anual de vacaciones de Comerciales Renosur es de 26 días laborables.
-- ============================================================================
-- Propósito:
-- Proporcionar la estructura DDL base de las tablas operativas de la aplicación
-- (tareas, vacaciones, promociones) para permitir el despliegue ordenado de
-- staging desde cero antes de aplicar el hardening de seguridad y RLS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABLA: TAREAS (Agenda de contactos y recordatorios de comerciales)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tareas (
    id VARCHAR(100) PRIMARY KEY,
    dni VARCHAR(20) NOT NULL,
    title TEXT,
    type VARCHAR(50) DEFAULT 'task',
    phone VARCHAR(50),
    date VARCHAR(20),
    time VARCHAR(20),
    notes TEXT,
    completed BOOLEAN DEFAULT false,
    notified BOOLEAN DEFAULT false,
    created_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_tareas_dni ON public.tareas(dni);
CREATE INDEX IF NOT EXISTS idx_tareas_date ON public.tareas(date);

COMMENT ON TABLE public.tareas IS 'Almacén de tareas, citas de agenda y recordatorios por comercial';

-- ----------------------------------------------------------------------------
-- 2. TABLA: VACACIONES (Control de calendario y ausencias)
-- ----------------------------------------------------------------------------
-- Regla de Negocio: Cupo de 26 días laborables anuales para Comerciales Renosur
CREATE TABLE IF NOT EXISTS public.vacaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dni VARCHAR(20) NOT NULL,
    fecha DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_vacaciones_dni_fecha UNIQUE (dni, fecha)
);

CREATE INDEX IF NOT EXISTS idx_vacaciones_dni ON public.vacaciones(dni);
CREATE INDEX IF NOT EXISTS idx_vacaciones_fecha ON public.vacaciones(fecha);

COMMENT ON TABLE public.vacaciones IS 'Días de vacaciones seleccionados por cada agente (límite comercial: 26 días laborables)';

-- ----------------------------------------------------------------------------
-- 3. TABLA: PROMOCIONES (Configuración de campañas y cobertura territorial)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promociones (
    id VARCHAR(100) PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT true,
    provinces JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.promociones IS 'Configuración de acuerdos comerciales activos por provincia y centros';

-- Datos semilla iniciales de promociones para staging
INSERT INTO public.promociones (id, active, provinces)
VALUES 
    ('leroy-merlin', true, '[{"name":"Sevilla","stores":["Dos Hermanas"],"delivery":"Tarjeta electronica al correo"}]'::jsonb),
    ('bricomart', false, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. TABLA LEGACY (OPCIONAL: Solo si staging simula transición desde sistema anterior)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agentes_roles (
    dni VARCHAR(20) PRIMARY KEY,
    rol VARCHAR(20) NOT NULL,
    pass VARCHAR(100),
    nombre VARCHAR(150),
    activo BOOLEAN DEFAULT true
);

COMMENT ON TABLE public.agentes_roles IS 'Tabla legacy de roles y claves en claro (será retirada tras verificar transición)';

COMMIT;
