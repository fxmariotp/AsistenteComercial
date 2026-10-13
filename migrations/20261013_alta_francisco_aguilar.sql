-- ============================================================================
-- ALTA SEGURA EN BASE DE DATOS: FRANCISCO JAVIER AGUILAR CHAVES (78105180D)
-- Archivo: migrations/20261013_alta_francisco_aguilar.sql
-- Rama: security-phase1-prep
-- ============================================================================
-- PRECONDICIONES OBLIGATORIAS:
-- 1. Este script SOLO debe ejecutarse en bases de datos que cuenten con el nuevo
--    esquema de seguridad (migrations/20261007_base_schema.sql y 20261008_security_auth_migration.sql).
-- 2. La tabla autoritativa es public.agentes_perfiles, vinculada a auth.users.
-- 3. NUNCA insertar contraseñas en texto plano en la tabla legada agentes_roles.
-- ============================================================================

DO $$
BEGIN
  -- 1. Comprobar que la tabla agentes_perfiles existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'agentes_perfiles'
  ) THEN
    RAISE EXCEPTION 'BLOQUEO: La tabla public.agentes_perfiles no existe. Aplique primero migrations/20261008_security_auth_migration.sql antes de dar de alta al comercial.';
  END IF;

  -- 2. Comprobar duplicados por DNI
  IF EXISTS (
    SELECT 1 FROM public.agentes_perfiles WHERE dni = '78105180D'
  ) THEN
    RAISE NOTICE 'El agente con DNI 78105180D ya existe en public.agentes_perfiles. No se duplica.';
  ELSE
    -- 3. Vincular perfil si el usuario ya existe en auth.users (creado previamente por la API admin o Dashboard)
    -- Si auth.users contiene 78105180d@asistente.internal:
    INSERT INTO public.agentes_perfiles (
      user_id,
      dni,
      nombre,
      rol,
      activo,
      must_change_password,
      created_at,
      updated_at
    )
    SELECT 
      u.id,
      '78105180D',
      'FRANCISCO JAVIER AGUILAR CHAVES',
      'comercial',
      true,
      true,
      NOW(),
      NOW()
    FROM auth.users u
    WHERE u.email = '78105180d@asistente.internal'
    ON CONFLICT (dni) DO NOTHING;

    IF FOUND THEN
      RAISE NOTICE 'Alta de FRANCISCO JAVIER AGUILAR CHAVES completada exitosamente en public.agentes_perfiles.';
    ELSE
      RAISE NOTICE 'Aviso: La identidad auth.users (78105180d@asistente.internal) aún no ha sido creada. Ejecute scripts/provision_alta_aguilar.js para crear usuario en Auth y perfil de forma atómica.';
    END IF;
  END IF;
END $$;
