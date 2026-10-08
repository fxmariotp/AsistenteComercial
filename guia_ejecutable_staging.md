# Guía Técnica Ejecutable para Validación en Staging Aislado
**Proyecto:** Asistente Comercial Renosur  
**Rama de trabajo:** `security-phase1-prep` (Commit `fddf916a1c53ef2523eb9e7869f51da2c4ff10d5`)  
**Regla de Negocio Protegida:** Cuota anual de vacaciones de Comerciales Renosur fijada en **26 días laborables**.

---

## 1. Auditoría de Permisos Efectivos y Conectividad

Antes de cualquier acción en el entorno, se ejecutó la comprobación formal de credenciales y permisos en la máquina de trabajo:

```powershell
# 1. Comprobación de herramientas CLI en el sistema
@('supabase', 'vercel', 'gcloud', 'gh', 'clasp', 'git') | ForEach-Object { 
    [PSCustomObject]@{ Tool = $_; Path = (Get-Command $_ -ErrorAction SilentlyContinue).Source } 
}

# 2. Inspección de variables de entorno de autenticación
Get-ChildItem env: | Where-Object { $_.Name -match "SUPABASE|VERCEL|GOOGLE|GCLOUD|TOKEN|KEY|SECRET" }

# 3. Inspección del Administrador de Credenciales de Windows
cmdkey /list
```

### Resultados de la Auditoría de Permisos:

1. **Supabase:**
   - **Estado:** ❌ Creación automatizada de proyecto bloqueada por falta de credenciales de gestión.
   - **Permiso que falta:** Token de Personal Access (`SUPABASE_ACCESS_TOKEN`) y `organization_id` para invocar la API de gestión (`POST https://api.supabase.com/v1/projects`).
   - **Aviso de coste / Facturación:** En el plan gratuito de Supabase (Free Tier) existe un límite estricto de **2 proyectos activos por organización**. Si la cuenta ya cuenta con 2 proyectos (ej. producción o desarrollos previos), la creación del proyecto aislado `asistente-comercial-staging` requiere obligatoriamente contratar el plan **Supabase Pro (25 $/mes + impuestos)**. No se realiza ninguna contratación sin autorización expresa previa.

2. **Google Cloud / Sheets / Apps Script:**
   - **Estado:** ❌ Creación automatizada de recursos bloqueada.
   - **Permiso que falta:** Credencial de Service Account (`GOOGLE_APPLICATION_CREDENTIALS` / JSON con roles `roles/sheets.editor`, `roles/resourcemanager.projectCreator`) y sesión OAuth de Apps Script (`clasp login`) para desplegar Web Apps mediante API.

3. **Vercel / GitHub:**
   - **Estado:** ✅ Despliegue Preview por Git disponible y ejecutado.
   - **Permiso verificado:** Acceso Git autenticado a `origin` (`https://github.com/fxmariotp/AsistenteComercial.git`).
   - **Comando ejecutado:**
     ```bash
     git push origin security-phase1-prep
     ```
     La rama `security-phase1-prep` (commit `fddf916`) fue publicada con éxito en GitHub, lo que activa el pipeline automático de Vercel Preview asociado al repositorio.

---

## 2. Preparación de Fuentes Sintéticas de Google

### 2.1. Hoja de Cálculo Sintética: Ranking
- Crear una hoja de cálculo con la pestaña denominada exactamente `Ranking`.
- Fila 1 (Cabecera):
  | Posición | Nombre | Puntos | Objetivo | Pendientes |
  | :--- | :--- | :--- | :--- | :--- |
- Filas de datos sintéticos:
  | 1 | COMERCIAL TEST A | 1540 | 16 | 2 |
  | 2 | COMERCIAL TEST B | 1320 | 16 | 0 |
- ID de la hoja: extraído de la URL (`/d/<SPREADSHEET_ID>/edit`).

### 2.2. Hoja de Cálculo Sintética: Comisiones
- Crear una hoja de cálculo con la pestaña `Comisiones`.
- Fila 1 (Cabecera):
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
El frontend carga de forma síncrona en el `<head>` antes de cualquier inicialización de Supabase:
```javascript
// config.js (Entorno Staging)
window.APP_CONFIG = {
  SUPABASE_URL: "https://<tu-proyecto-staging>.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  ENVIRONMENT: "staging"
};
```
*Si este archivo falta o contiene valores vacíos, `index.html` y `login.html` detienen la ejecución y muestran un overlay de error visual sin intentar conectar con ningún servicio.*

### 3.2. Carga de Variables Privadas en Vercel Preview (`.env`)
En el panel de Vercel (*Project Settings > Environment Variables*), configurar para el entorno **Preview**:
```ini
# Supabase Staging
SUPABASE_URL=https://<tu-proyecto-staging>.supabase.co
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

## 4. Orden Exacto de Migraciones y Aprovisionamiento en Staging

Las operaciones en la base de datos staging deben ejecutarse estrictamente en este orden:

```mermaid
flowchart TD
    A["Paso 1: Esquema Base DDL<br/>migrations/20261007_base_schema.sql"] --> B["Paso 2: Hardening, Auth y RLS<br/>migrations/20261008_security_auth_migration.sql"]
    B --> C["Paso 3: Aprovisionamiento de Identidades<br/>node scripts/provision_identities.js --confirm-staging"]
    C --> D["Paso 4: Auditoría Solo Lectura<br/>migrations/verify_rls_policies_readonly.sql"]
```

> [!NOTE]
> En esta instalación limpia de staging, **se omite** `migrations/data_transition_and_rollback.sql` para evitar operaciones destructivas innecesarias sobre tablas que no tienen registros legacy.

### Paso 1: Esquema Base DDL
Ejecutar en el SQL Editor de Supabase:
`migrations/20261007_base_schema.sql`
- Crea las tablas operativas: `tareas`, `vacaciones` y `promociones`.
- Define restricciones de unicidad e índices.
- Formaliza la regla de negocio de los **26 días laborables de vacaciones**.

### Paso 2: Hardening, Supabase Auth y RLS
Ejecutar en el SQL Editor de Supabase:
`migrations/20261008_security_auth_migration.sql`
- Crea `agentes_perfiles` vinculada a `auth.users` y `conexiones_audit`.
- Define funciones `SECURITY DEFINER` (`current_user_dni()`, `is_gerente()`, `is_active_agent()`).
- Activa Row Level Security en todas las tablas.
- Limpia preventivamente mediante bucle dinámico sobre `pg_policies` y crea políticas de mínimo privilegio.
- **Acceso a perfil propio:** La política `agentes_perfiles_select` (`USING (user_id = auth.uid())`) permite al usuario autenticado consultar su propio perfil incluso con `must_change_password = true`, mientras bloquea el acceso a todas las demás tablas operativas.
- Revoca todos los permisos al rol anónimo (`anon`) y a la tabla legacy `agentes_roles`.

### Paso 3: Aprovisionamiento de Identidades Ficticias
Configurar las variables de staging en el entorno local y ejecutar:
```bash
node scripts/provision_identities.js --confirm-staging
```
*El script valida estrictamente la presencia de `--confirm-staging` y comprueba que `SUPABASE_URL` no coincida con el entorno de producción.*
Genera las 6 identidades sintéticas con contraseñas temporales aleatorias de alta entropía:
1. `00000001a@asistente.internal` | DNI: `00000001A` | Comercial Activo | must_change: false
2. `00000002b@asistente.internal` | DNI: `00000002B` | Comercial Activo | must_change: false
3. `00000003g@asistente.internal` | DNI: `00000003G` | Gerente | must_change: false
4. `00000004e@asistente.internal` | DNI: `00000004E` | Evaria | must_change: false
5. `00000005i@asistente.internal` | DNI: `00000005I` | Inactivo | must_change: false
6. `00000006x@asistente.internal` | DNI: `00000006X` | Cambio Obligatorio | must_change: true

### Paso 4: Verificación de Solo Lectura
Ejecutar `migrations/verify_rls_policies_readonly.sql` para comprobar el catálogo de PostgreSQL y confirmar que todas las tablas tienen RLS habilitado y que `anon` no tiene permisos.

---

## 5. Procedimiento de Validación Real con Resultados Esperados

### 5.1. Comercial Activo A (`00000001A`) y Comercial Activo B (`00000002B`)
- **Comisión individual:** Al consultar `/api/comisiones`, el comercial recibe exclusivamente su propia comisión (**350.50 €** para A, **420.00 €** para B).
- **Resultado esperado correcto:** `isGerente: false`, `data: undefined` (no se expone el mapa consolidado del equipo ni comisiones de otros comerciales).
- **Aislamiento de tareas (RLS):** Cada comercial solo puede leer e insertar tareas asociadas a su propio DNI (`dni = current_user_dni()`). Las tareas de A son invisibles para B y viceversa.

### 5.2. Gerente (`00000003G`)
- **Permisos de equipo:** Al consultar `/api/comisiones`, recibe `isGerente: true` y el mapa completo consolidado `data: { ... }`.
- **Separación de agendas privadas:** Sus tareas privadas no son visibles para los comerciales, y el gerente no accede indebidamente a las agendas privadas de los agentes (`tareas_select_propio` exige DNI propio).

### 5.3. Evaria (`00000004E`)
- **Ranking:** Petición a `/api/ranking` devuelve `HTTP 403 Forbidden` (`{"error": "El perfil Evaria no tiene acceso al módulo de ranking."}`).
- **Comisiones:** Petición a `/api/comisiones` devuelve `HTTP 403 Forbidden`.

### 5.4. Usuario Inactivo (`00000005I`)
- **Bloqueo inmediato:** Al iniciar sesión, `loadSession()` detecta `activo === false`, muestra alerta *"Tu cuenta ha sido desactivada por gerencia"* y ejecuta `logout()` inmediato.
- **Endpoints de servidor:** Peticiones a `/api/ranking` y `/api/comisiones` denegadas con `HTTP 403 Forbidden`.

### 5.5. Cambio Pendiente (`00000006X`) y Acceso al Perfil Propio
- **Acceso al perfil propio durante cambio obligatorio:** El usuario autenticado puede consultar `agentes_perfiles` para conocer su propio estado (`user_id = auth.uid()`), lo que permite a `login.html` cargar su nombre y mostrar el modal de cambio obligatorio.
- **Bloqueo operativo:** Consultas a `tareas`, `vacaciones`, `promociones`, `/api/ranking` y `/api/comisiones` devuelven 0 filas o `HTTP 403` con `mustChangePassword: true`.
- **Modal persistente tras recarga (F5):** Al recargar `login.html`, `supabase.auth.getSession()` evalúa el perfil y mantiene el modal abierto sin redirigir a `index.html`.
- **Modal persistente en nueva pestaña:** Si abre `index.html` en una nueva pestaña, `loadSession()` detecta `must_change_password === true` y redirige inmediatamente a `login.html`. Si abre `login.html`, el modal se activa de inmediato.
- **Cambio efectivo y desbloqueo:** Invocación a `POST /api/update-password` con contraseña válida distinta al DNI actualiza Supabase Auth y cambia `must_change_password = false` en `agentes_perfiles` (HTTP 200). A partir de ese momento, el acceso a `index.html`, ranking y comisiones queda desbloqueado.

### 5.6. Acceso Anónimo
- Peticiones sin token a `/api/ranking`, `/api/comisiones` o `/api/update-password` devuelven `HTTP 401 Unauthorized`.
- Consultas directas a PostgREST sin token devuelven `HTTP 401` o 0 filas (privilegios a `anon` totalmente revocados).

### 5.7. Ranking: Tratamiento de Errores y Fallback
- **Error explícito de Apps Script (401/403):** Devuelve el código HTTP exacto de Apps Script sin fallback a caché.
- **Error de formato o JSON corrupto:** Devuelve **`HTTP 502 Bad Gateway` (NUNCA 200)**, incluso con caché reciente en memoria.
- **Fallo transitorio (timeout, ECONNRESET):** Entrega datos de caché únicamente si su antigüedad es $\le$ 5 minutos (`X-Cache-Status: STALE`, `Warning: 110`). Si supera los 5 minutos, responde `HTTP 502`.

### 5.8. Conservación de Vacaciones
- La cuota anual de vacaciones para Comerciales Renosur se mantiene formalizada en **26 días laborables**.

---

## 6. Desglose del Estado de Comprobaciones

| Ámbito | Estado | Evidencias |
| :--- | :--- | :--- |
| **Pruebas Estáticas** | **100% Superado** | 23/23 en `test_security_phase1.ps1`; 39/39 en `test_functional_suite.ps1` |
| **Pruebas Simuladas (Runtime)** | **100% Superado** | 18/18 en `test_runtime_verifications.js` ejecutando código real de handlers y scripts |
| **Despliegue Preview en Vercel** | **Publicado vía Git** | Rama `security-phase1-prep` publicada en `origin`; commit `fddf916` |
| **Instancia Cloud Supabase Staging** | **Pendiente de Aprovisionamiento Externo** | Requiere crear el proyecto en Supabase (aviso: coste $25/mes si ya existen 2 proyectos) |
| **Google Cloud Service Account Staging** | **Pendiente de Aprovisionamiento Externo** | Requiere Service Account de prueba con acceso a hoja de comisiones |
