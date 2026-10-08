# Guía Técnica Ejecutable para Validación en Staging Aislado
**Proyecto:** Asistente Comercial Renosur  
**Rama de trabajo:** `security-phase1-prep`  
**Regla de Negocio Protegida:** Cuota anual de vacaciones de Comerciales Renosur fijada en **26 días laborables**.

---

## 1. Intervención Requerida del Usuario para Habilitar Staging

Para desplegar y ejecutar las comprobaciones en un entorno de staging real, aislado de producción y sin comprometer datos reales:

1. **Proyecto de Supabase Aislado (Staging):**
   - Crear un proyecto nuevo (staging) en [Supabase](https://supabase.com).
   - Extraer de *Settings > API*:
     - `SUPABASE_URL` (ej. `https://xyz-staging.supabase.co`)
     - `SUPABASE_ANON_KEY` (clave pública del navegador)
     - `SUPABASE_SERVICE_ROLE_KEY` (clave secreta exclusiva de backend)

2. **Google Cloud Service Account (Staging):**
   - Habilitar Google Sheets API v4 en un proyecto GCP de pruebas.
   - Crear una Service Account y descargar su clave privada JSON (`client_email`, `private_key`).
   - Crear una hoja de cálculo sintética de comisiones en Google Drive y compartirla con permiso de lectura con el `client_email`.

3. **Google Apps Script Web App (Staging):**
   - En [Google Apps Script](https://script.google.com), crear un proyecto vinculado a una hoja sintética de ranking.
   - Pegar el código de `google_apps_script/ranking_receiver.gs`.
   - En *Propiedades del script*, configurar `RANKING_SHARED_SECRET` y `SPREADSHEET_ID`.
   - Implementar como Aplicación Web (*Ejecutar como: Yo*, *Acceso: Cualquier usuario*).
   - Copiar la URL de implementación generada (`https://script.google.com/macros/s/.../exec`).

---

## 2. Preparación de Fuentes Sintéticas de Google

### 2.1. Hoja de Cálculo Sintética: Ranking
- Crear una hoja de cálculo con la pestaña denominada exactamente `Ranking`.
- Fila de cabecera (Fila 1):
  | Posición | Nombre | Puntos | Objetivo | Pendientes |
  | :--- | :--- | :--- | :--- | :--- |
- Filas de datos sintéticos (Fila 2 en adelante):
  | 1 | COMERCIAL TEST A | 1540 | 16 | 2 |
  | 2 | COMERCIAL TEST B | 1320 | 16 | 0 |
- ID de la hoja: extraído de la URL (`/d/<SPREADSHEET_ID>/edit`).

### 2.2. Hoja de Cálculo Sintética: Comisiones
- Crear una hoja de cálculo con la pestaña `Comisiones`.
- Fila de cabecera:
  | AGENTE | COMI |
  | :--- | :--- |
- Filas de datos sintéticos:
  | COMERCIAL TEST A | 350.50 |
  | COMERCIAL TEST B | 420.00 |
  | GERENTE TEST | 0.00 |
- Compartir con la Service Account configurada para `/api/comisiones`.

---

## 3. Configuración Desacoplada: Cliente vs Servidor

### 3.1. Configuración Pública del Cliente (`config.js`)
El frontend carga de forma síncrona en el `<head>` antes de cualquier ejecución de Supabase:
```javascript
// config.js (Entorno Staging)
window.APP_CONFIG = {
  SUPABASE_URL: "https://xyz-staging.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  ENVIRONMENT: "staging"
};
```
*Si este archivo falta o no define las variables requeridas, tanto `index.html` como `login.html` detienen de inmediato la inicialización y muestran un mensaje visible de error de configuración.*

### 3.2. Variables Privadas del Servidor (`.env` / Variables Vercel)
Los endpoints en `api/*.js` consumen exclusivamente las variables privadas de servidor:
```ini
# Supabase Staging
SUPABASE_URL=https://xyz-staging.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Google Sheets Comisiones (OAuth 2.0 Servidor)
GOOGLE_SERVICE_ACCOUNT_EMAIL=sa-staging@mi-proyecto-staging.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1a2b3c4d5e6f7g8h9i0j_staging_sheet_id

# Google Apps Script Ranking (POST Servidor a Servidor con Secreto Compartido)
RANKING_APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbz_staging/exec
RANKING_SHARED_SECRET=clave_criptografica_compartida_staging_64_hex
```

---

## 4. Orden Exacto de Migraciones y Aprovisionamiento

Las operaciones en base de datos deben ejecutarse estrictamente en el siguiente orden:

```mermaid
flowchart TD
    A["Paso 1: Esquema Base DDL<br/>migrations/20261007_base_schema.sql"] --> B["Paso 2: Hardening, Auth y RLS<br/>migrations/20261008_security_auth_migration.sql"]
    B --> C["Paso 3: Aprovisionamiento de Identidades<br/>node scripts/provision_identities.js --confirm-staging"]
    C --> D{"¿Existen datos legacy<br/>que migrar en Staging?"}
    D -- Sí --> E["Paso 4: Transición Atómica de Datos<br/>migrations/data_transition_and_rollback.sql"]
    D -- No (Instalación limpia) --> F["Paso 4 omitido<br/>(No ejecutar operaciones destructivas)"]
    E --> G["Paso 5: Verificación RLS Solo Lectura<br/>migrations/verify_rls_policies_readonly.sql"]
    F --> G
```

### Paso 1: Esquema Base DDL
Ejecutar en el SQL Editor de Supabase:
`migrations/20261007_base_schema.sql`
- Crea tablas operativas `tareas`, `vacaciones` y `promociones`.
- Define índices de rendimiento y formaliza la regla de los **26 días laborables**.

### Paso 2: Hardening, Supabase Auth y RLS
Ejecutar en el SQL Editor de Supabase:
`migrations/20261008_security_auth_migration.sql`
- Crea `agentes_perfiles` y `conexiones_audit`.
- Define funciones `SECURITY DEFINER` (`current_user_dni()`, `is_gerente()`, `is_active_agent()`).
- Activa Row Level Security en todas las tablas.
- Limpia preventivamente mediante bucle dinámico sobre `pg_policies` y crea políticas de mínimo privilegio.
- Revoca permisos a `anon` y revoca accesos a la tabla antigua `agentes_roles`.

### Paso 3: Aprovisionamiento de Identidades Ficticias
Configurar las variables de entorno de staging y ejecutar:
```bash
node scripts/provision_identities.js --confirm-staging
```
*El script exige obligatoriamente `--confirm-staging` y valida que la URL destino no sea producción.*
Genera las 6 identidades sintéticas con contraseñas criptográficas seguras:
1. `00000001a@asistente.internal` | DNI: `00000001A` | Comercial Activo | must_change: false
2. `00000002b@asistente.internal` | DNI: `00000002B` | Comercial Activo | must_change: false
3. `00000003g@asistente.internal` | DNI: `00000003G` | Gerente | must_change: false
4. `00000004e@asistente.internal` | DNI: `00000004E` | Evaria | must_change: false
5. `00000005i@asistente.internal` | DNI: `00000005I` | Inactivo | must_change: false
6. `00000006x@asistente.internal` | DNI: `00000006X` | Cambio Obligatorio | must_change: true

### Paso 4: Transición Atómica (Condicional)
`migrations/data_transition_and_rollback.sql` **solo** se ejecuta si se están migrando datos legacy (`SYSTEM_LOGIN_LOG` en `tareas`). En instalaciones limpias se omite para evitar ejecutar operaciones destructivas innecesarias.

### Paso 5: Auditoría Solo Lectura
Ejecutar `migrations/verify_rls_policies_readonly.sql` para comprobar el estado de las políticas RLS y privilegios activos.

---

## 5. Procedimiento de Validación Real de los Seis Perfiles

### 5.1. Comercial Activo A (`00000001A`)
1. Iniciar sesión en `login.html`.
2. Verificar redirección exitosa a `index.html`.
3. Consultar ranking: devuelve la tabla de puntos del equipo correctamente.
4. Consultar comisiones: muestra únicamente **350.50 €**; no expone datos de otros comerciales ni `isGerente`.
5. Crear una tarea en la agenda. La tarea se guarda con su propio DNI.

### 5.2. Comercial Activo B (`00000002B`) - Aislamiento RLS
1. Iniciar sesión como Comercial B.
2. Comisiones: muestra únicamente **420.00 €**; aislamiento total respecto a Comercial A.
3. Agenda: la tarea creada por Comercial A **no aparece**.
4. Intento de consulta directa a PostgREST (`/rest/v1/tareas`): devuelve solo las tareas propias.
5. Intento de inserción suplantando el DNI de A: denegado con HTTP 403 / error de RLS.

### 5.3. Gerente (`00000003G`)
1. Iniciar sesión como Gerente.
2. Ranking: visualiza el ranking del equipo completo.
3. Comisiones: visualiza el mapa consolidado de comisiones de todos los comerciales (`isGerente = true`).
4. Agenda privada: sus tareas privadas no son visibles para los comerciales, y el gerente no accede indebidamente a las agendas privadas individuales de los agentes.

### 5.4. Evaria (`00000004E`)
1. Iniciar sesión como Evaria.
2. Intento de acceso al módulo de ranking: bloqueado con HTTP 403 Forbidden.
3. Intento de acceso a comisiones: bloqueado con HTTP 403 Forbidden.
4. Paneles administrativos en `index.html`: inaccesibles y ocultos.

### 5.5. Usuario Inactivo (`00000005I`)
1. Intentar inicio de sesión en `login.html`.
2. `loadSession()` detecta `activo === false`: alerta visible en pantalla *"Tu cuenta ha sido desactivada por gerencia"*, cierre de sesión inmediato y revocación de acceso.
3. Intentos de llamada directa a `/api/ranking` o `/api/comisiones` con su token: denegados con HTTP 403 Forbidden.

### 5.6. Cambio Obligatorio de Contraseña (`00000006X`)
1. Intentar llamadas a `/api/ranking` y `/api/comisiones`: ambas deniegan el acceso con HTTP 403 y `mustChangePassword: true`.
2. Consultas a PostgREST: devuelven 0 registros porque `current_user_dni()` retorna `NULL` mientras `must_change_password = true`.
3. Intentar cambiar la contraseña por su propio DNI (`00000006X`): `api/update-password` rechaza con HTTP 400.
4. Introducir una contraseña segura distinta: `api/update-password` actualiza Supabase Auth, actualiza `agentes_perfiles` a `must_change_password = false` y devuelve HTTP 200 con el perfil actualizado.
5. Acceso posterior: ranking y comisiones quedan desbloqueados de inmediato.

---

## 6. Validación de Retención en Primer Acceso: Recarga y Nueva Pestaña

Flujo crítico para evitar bucles de redirección infinita (`login -> index -> login`):

1. **Inicio de Sesión Inicial:**
   - Iniciar sesión en `login.html` con las credenciales temporales de `00000006X`.
   - `login.html` valida el perfil en `agentes_perfiles` **antes** de redirigir.
   - Detecta `must_change_password === true`.
   - **Comportamiento esperado:** Permanece en `login.html`, no redirige a `index.html` y abre automáticamente el modal de cambio obligatorio de contraseña.

2. **Prueba de Recarga (F5):**
   - Con el modal abierto en `login.html`, pulsar F5 o refrescar la página.
   - El evento `supabase.auth.getSession()` recupera la sesión activa.
   - Consulta el perfil autoritativo del usuario.
   - **Comportamiento esperado:** El usuario permanece en `login.html` con el modal abierto. Cero redirecciones a `index.html`.

3. **Prueba de Nueva Pestaña a `index.html`:**
   - Sin cerrar la pestaña anterior y sin cambiar la contraseña, abrir una nueva pestaña y navegar directamente a `index.html`.
   - `loadSession()` en `index.html` consulta `agentes_perfiles`.
   - Detecta `must_change_password === true`.
   - Muestra aviso al usuario y redirige de inmediato a `login.html`.
   - **Comportamiento esperado:** Acceso denegado en `index.html`; en `login.html` se activa el flujo de cambio obligatorio.

4. **Prueba de Nueva Pestaña a `login.html`:**
   - Abrir una nueva pestaña en `login.html`.
   - Se detecta la sesión activa con `must_change_password === true`.
   - El modal de cambio obligatorio se renderiza automáticamente. Cero bucles.

5. **Resolución:**
   - Se ingresa la nueva contraseña en el modal.
   - Tras recibir confirmación de `api/update-password` (HTTP 200), se actualiza el estado local y se redirige con éxito a `index.html`.

---

## 7. Desglose de Pruebas: Estáticas, Simuladas y Reales

| Tipo de Comprobación | Ámbito | Estado | Resultados |
| :--- | :--- | :--- | :--- |
| **Estática** | Código fuente, scripts SQL, expresiones regulares, políticas RLS, XSS sanitization, 26 días laborables | **100% Superado** | 23/23 comprobaciones superadas en `test_security_phase1.ps1` |
| **Simulada (Runtime)** | Ejecución real de handlers (`api/*.js`), receptor Apps Script (`ranking_receiver.gs`), clasificación estructurada de errores, 502 ante formato inválido, aprovisionamiento anti-producción, scoping de comisiones | **100% Superado** | 18/18 pruebas de tiempo real superadas en `test_runtime_verifications.js` |
| **Real (Staging)** | Infraestructura externa en nube (Supabase staging cloud, Google Cloud IAM, Google Apps Script Web App en producción/staging real) | **Pendiente de Aprovisionamiento Externo** | Requiere los recursos indicados en la Sección 1 |
