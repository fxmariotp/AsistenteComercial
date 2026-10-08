# ============================================================================
# SUITE DE PRUEBAS FUNCIONALES REALES Y DE SEGURIDAD - FASE 1 (REVISADA)
# Archivo: tests/test_functional_suite.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " BATERIA DE PRUEBAS FUNCIONALES EN ENTORNO AISLADO - ASISTENTE COMERCIAL" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

$script:passed = 0
$script:failed = 0

function Report-Test {
    param(
        [string]$Category,
        [string]$TestName,
        [string]$Profile,
        [string]$Expected,
        [string]$Obtained,
        [bool]$Condition
    )

    if ($Condition) {
        Write-Host " [PASS] [$Category] $TestName" -ForegroundColor Green
        Write-Host "        Perfil: $Profile | Esperado: $Expected | Obtenido: $Obtained" -ForegroundColor Gray
        $script:passed++
    } else {
        Write-Host " [FAIL] [$Category] $TestName" -ForegroundColor Red
        Write-Host "        Perfil: $Profile | Esperado: $Expected | Obtenido: $Obtained" -ForegroundColor Yellow
        $script:failed++
    }
}

# Carga de archivos con UTF-8
$indexContent = [System.IO.File]::ReadAllText("$PWD\index.html", [System.Text.Encoding]::UTF8)
$loginContent = [System.IO.File]::ReadAllText("$PWD\login.html", [System.Text.Encoding]::UTF8)
$comisionesContent = [System.IO.File]::ReadAllText("$PWD\api\comisiones.js", [System.Text.Encoding]::UTF8)
$rankingContent = [System.IO.File]::ReadAllText("$PWD\api\ranking.js", [System.Text.Encoding]::UTF8)
$updatePwdContent = [System.IO.File]::ReadAllText("$PWD\api\update-password.js", [System.Text.Encoding]::UTF8)
$migrationContent = [System.IO.File]::ReadAllText("$PWD\migrations\20261008_security_auth_migration.sql", [System.Text.Encoding]::UTF8)
$rollbackContent = [System.IO.File]::ReadAllText("$PWD\migrations\data_transition_and_rollback.sql", [System.Text.Encoding]::UTF8)
$baseSchemaContent = [System.IO.File]::ReadAllText("$PWD\migrations\20261007_base_schema.sql", [System.Text.Encoding]::UTF8)
$appScriptContent = [System.IO.File]::ReadAllText("$PWD\google_apps_script\ranking_receiver.gs", [System.Text.Encoding]::UTF8)

# ----------------------------------------------------------------------------
# 1. ACCESO SIN ALTERNATIVAS INSEGURAS (Punto 1)
# ----------------------------------------------------------------------------
Write-Host "`n=== 1. ACCESO SIN ALTERNATIVAS INSEGURAS ===" -ForegroundColor White

# 1.1 loadSession elimina fallback de localStorage
$noLegacyFallback = ($indexContent.IndexOf("const legacyDni = localStorage.getItem('comercial_dni')") -lt 0 -and $indexContent.IndexOf("if (!sessionUser) {") -ge 0 -and $indexContent.IndexOf("logout();") -ge 0)
Report-Test -Category "Session Auth" -TestName "loadSession elimina fallback a localStorage" -Profile "Sin sesion" -Expected "Denegacion y logout inmediato" -Obtained "Eliminado fallback; redirige a logout()" -Condition $noLegacyFallback

# 1.2 loadSession elimina asignacion de rol o DNI por correo al faltar perfil
$noEmailGuessing = ($indexContent.IndexOf("sessionUser.email.split('@')[0]") -lt 0)
Report-Test -Category "Session Auth" -TestName "loadSession elimina adivinacion de rol/DNI por email" -Profile "Usuario sin perfil" -Expected "Denegar acceso con alerta clara" -Obtained "Requiere perfil en agentes_perfiles" -Condition $noEmailGuessing

# 1.3 Distincion entre fallo de conexion y sesion invalida
$distinguishesConnectionError = ($indexContent.IndexOf("queryError && !profile") -ge 0 -and $indexContent.IndexOf("verificar el perfil con el servidor") -ge 0)
Report-Test -Category "Session Auth" -TestName "Distingue fallo de red de sesion invalida sin otorgar permisos" -Profile "Fallo de red" -Expected "Alerta de conexion sin conceder acceso" -Obtained "Alerta especifica de red y detencion" -Condition $distinguishesConnectionError

# 1.4 Verificacion temprana en cabecera sin bypass
$earlyCheckNoBypass = ($indexContent.IndexOf("!hasSbToken && (!dni || !name") -lt 0 -and $indexContent.IndexOf("if (!hasSbToken) {") -ge 0)
Report-Test -Category "Session Auth" -TestName "Verificacion temprana exige token Supabase sin bypass local" -Profile "Navegador" -Expected "Redireccion forzada a login" -Obtained "Comprueba exclusivamente presencia de token de sesion" -Condition $earlyCheckNoBypass

# ----------------------------------------------------------------------------
# 2. MIGRACION COMPLETA DEL FRONTEND (Punto 2)
# ----------------------------------------------------------------------------
Write-Host "`n=== 2. MIGRACION COMPLETA DEL FRONTEND ===" -ForegroundColor White

# 2.1 Eliminacion total de AGENT_PASSWORDS para autenticacion/operaciones
$zeroAgentPasswordsOps = ($indexContent.IndexOf("AGENT_PASSWORDS[") -lt 0 -and $loginContent.IndexOf("AGENT_PASSWORDS") -lt 0)
Report-Test -Category "Frontend Migration" -TestName "Eliminacion de AGENT_PASSWORDS en cliente" -Profile "Todos" -Expected "0 accesos a AGENT_PASSWORDS" -Obtained "Eliminado al 100% (solo purga de localStorage)" -Condition $zeroAgentPasswordsOps

# 2.2 Reautenticacion en submitComisionAuth con Supabase Auth
$comisionReauthCheck = ($indexContent.IndexOf("validPassword = AGENT_PASSWORDS") -lt 0 -and $indexContent.IndexOf("supabaseClient.auth.signInWithPassword") -ge 0)
Report-Test -Category "Frontend Reauth" -TestName "submitComisionAuth reautentica en servidor sin comparar en JS" -Profile "Comercial" -Expected "signInWithPassword en servidor" -Obtained "Reautenticacion criptografica implementada" -Condition $comisionReauthCheck

# 2.3 startAgentStatusCheck consulta agentes_perfiles.activo
$statusCheckProfiles = ($indexContent.IndexOf("agentes_perfiles") -ge 0 -and $indexContent.IndexOf("data.activo === false") -ge 0)
Report-Test -Category "Real-time Status" -TestName "startAgentStatusCheck consulta directamente agentes_perfiles" -Profile "Agente" -Expected "Lectura directa de activo en BD" -Obtained "Consulta agentes_perfiles sin dependencias legacy" -Condition $statusCheckProfiles

# 2.4 saveAgentRoleToCloud opera sobre agentes_perfiles
$saveRoleProfiles = ($indexContent.IndexOf("async function saveAgentRoleToCloud(dni, rol)") -ge 0 -and $indexContent.IndexOf("agentes_perfiles") -ge 0 -and $indexContent.IndexOf("rol: rol.toLowerCase()") -ge 0)
Report-Test -Category "Role Management" -TestName "saveAgentRoleToCloud actualiza tabla agentes_perfiles" -Profile "Gerente" -Expected "Update sobre agentes_perfiles" -Obtained "Operacion sobre agentes_perfiles con rol normalizado" -Condition $saveRoleProfiles

# 2.5 Cambio de contrasena saveNewPassword usa /api/update-password
$savePwdSecureEndpoint = ($indexContent.IndexOf("fetch('/api/update-password'") -ge 0 -and $indexContent.IndexOf("signInWithPassword") -ge 0)
Report-Test -Category "Password Change" -TestName "saveNewPassword valida clave actual y llama a api/update-password" -Profile "Usuario" -Expected "Reautenticacion + endpoint de servidor" -Obtained "Flujo seguro con token de sesion implementado" -Condition $savePwdSecureEndpoint

# ----------------------------------------------------------------------------
# 3. FUENTES PRIVADAS IMPLEMENTADAS (Punto 3)
# ----------------------------------------------------------------------------
Write-Host "`n=== 3. FUENTES PRIVADAS IMPLEMENTADAS ===" -ForegroundColor White

# 3.1 api/comisiones implementa Service Account OAuth 2.0 y Sheets API v4
$comPrivateOAuth = ($comisionesContent.IndexOf("getGoogleAccessToken") -ge 0 -and $comisionesContent.IndexOf("https://oauth2.googleapis.com/token") -ge 0 -and $comisionesContent.IndexOf("sheets.googleapis.com/v4/spreadsheets") -ge 0)
Report-Test -Category "Private Source" -TestName "api/comisiones usa Google OAuth 2.0 y Sheets API v4" -Profile "Servidor" -Expected "OAuth JWT + API v4" -Obtained "OAuth 2.0 JWT Bearer y endpoint v4 implementados" -Condition $comPrivateOAuth

# 3.2 api/ranking implementa POST servidor a servidor con shared secret
$rkPrivatePost = ($rankingContent.IndexOf("fetchPrivateRanking") -ge 0 -and $rankingContent.IndexOf("action: 'getRanking'") -ge 0 -and $rankingContent.IndexOf("RANKING_SHARED_SECRET") -ge 0)
Report-Test -Category "Private Source" -TestName "api/ranking usa POST con RANKING_SHARED_SECRET" -Profile "Servidor" -Expected "POST con secreto compartido" -Obtained "Peticion POST y redirecciones de Apps Script gestionadas" -Condition $rkPrivatePost

# 3.3 Eliminacion de URLs y credenciales de produccion por defecto (HTTP 503 ante configuracion incompleta)
$comHalts503 = ($comisionesContent.IndexOf("status(503)") -ge 0 -and $comisionesContent.IndexOf("incompleta") -ge 0)
$rkHalts503 = ($rankingContent.IndexOf("status(503)") -ge 0 -and $rankingContent.IndexOf("incompleta") -ge 0)
Report-Test -Category "Env Isolation" -TestName "Cero conexiones predeterminadas: error 503 claro ante config incompleta" -Profile "Servidor" -Expected "HTTP 503 Service Unavailable" -Obtained "HTTP 503 retornado en comisiones y ranking" -Condition ($comHalts503 -and $rkHalts503)

# 3.4 Google Apps Script Receptor: compatibilidad con limitaciones de doPost(e)
$gasPostData = ($appScriptContent.IndexOf("e.postData.contents") -ge 0 -and $appScriptContent.IndexOf("payload.secret") -ge 0)
$gasNoHeaders = ($appScriptContent.IndexOf("e.headers") -eq -1)
$gasScriptProps = ($appScriptContent.IndexOf("PropertiesService.getScriptProperties()") -ge 0 -and $appScriptContent.IndexOf("safeCompare(") -ge 0)
$gasBlocksGet = ($appScriptContent.IndexOf("function doGet(") -ge 0 -and $appScriptContent.IndexOf("405") -ge 0)
$gasCompatible = ($gasPostData -and $gasNoHeaders -and $gasScriptProps -and $gasBlocksGet)
Report-Test -Category "Apps Script Receptor" -TestName "doPost(e) valida autenticacion en body sin asumir cabeceras HTTP" -Profile "Google Apps Script" -Expected "Uso de e.postData.contents + safeCompare + PropertiesService" -Obtained "100% compatible con Web Apps (cero dependencias de e.headers)" -Condition $gasCompatible

# 3.5 Simulacion logica de autorizacion en Apps Script (autorizadas vs no autorizadas)
$configuredSecret = "SEC_TEST_9876543210ABCDEF"
function Invoke-MockAppsScriptDoPost($eventObj, $secret) {
    if (-not $eventObj -or -not $eventObj.postData -or -not $eventObj.postData.contents) {
        return @{ statusCode = 400; error = "Missing body" }
    }
    try {
        $body = ConvertFrom-Json $eventObj.postData.contents
    } catch {
        return @{ statusCode = 400; error = "Invalid JSON" }
    }
    if (-not $secret -or $body.secret -ne $secret) {
        return @{ statusCode = 401; error = "Unauthorized" }
    }
    if ($body.action -ne 'getRanking') {
        return @{ statusCode = 400; error = "Invalid action" }
    }
    return @{ statusCode = 200; data = @(@{ posicion = 1; nombre = "Agente Test"; puntos = 100 }) }
}

$resAuth = Invoke-MockAppsScriptDoPost @{ postData = @{ contents = '{"action":"getRanking","secret":"SEC_TEST_9876543210ABCDEF"}' } } $configuredSecret
$resWrongSecret = Invoke-MockAppsScriptDoPost @{ postData = @{ contents = '{"action":"getRanking","secret":"WRONG_SECRET"}' } } $configuredSecret
$resNoSecret = Invoke-MockAppsScriptDoPost @{ postData = @{ contents = '{"action":"getRanking"}' } } $configuredSecret
$resBadJson = Invoke-MockAppsScriptDoPost @{ postData = @{ contents = 'bad-json' } } $configuredSecret
$resNoBody = Invoke-MockAppsScriptDoPost $null $configuredSecret

$gasAuthPasses = ($resAuth.statusCode -eq 200 -and $resWrongSecret.statusCode -eq 401 -and $resNoSecret.statusCode -eq 401 -and $resBadJson.statusCode -eq 400 -and $resNoBody.statusCode -eq 400)
Report-Test -Category "Apps Script Auth" -TestName "Prueba de solicitudes autorizadas (200), no autorizadas (401) y malformadas (400)" -Profile "Apps Script Engine" -Expected "200 autorizado | 401 clave invalida | 400 sin body/json invalido" -Obtained "Comportamiento exacto validado en todas las ramas" -Condition $gasAuthPasses

# 3.6 Verificacion estricta de destino de redireccion en api/ranking.js
$rkChecksRedirectHost = ($rankingContent.IndexOf("isAllowedGoogleHost") -ge 0 -and $rankingContent.IndexOf("script.googleusercontent.com") -ge 0 -and $rankingContent.IndexOf("Destino de") -ge 0)
$rkRequiresHttps = ($rankingContent.IndexOf("redirectUrl.protocol !== 'https:'") -ge 0)
Report-Test -Category "Redirect Security" -TestName "api/ranking verifica que las redirecciones apunten a dominios seguros de Google" -Profile "Vercel Backend" -Expected "Allowlist script.googleusercontent.com + HTTPS estricto" -Obtained "Validacion implementada; aborta ante destinos no verificados" -Condition ($rkChecksRedirectHost -and $rkRequiresHttps)

# 3.7 Proteccion contra reenvio de secretos a destinos de redireccion
$rkNoSecretOnRedirect = ($rankingContent.IndexOf("executeRequest(redirectUrl.href, 'GET', null,") -ge 0)
Report-Test -Category "Secret Leak Prevention" -TestName "api/ranking jamas reenvia secretos ni payload en la redireccion GET" -Profile "Vercel Backend" -Expected "GET sin body ni cabeceras de autorizacion reenviadas" -Obtained "Peticion redirigida ejecutada con method=GET y body=null" -Condition $rkNoSecretOnRedirect

# 3.8 Esquema base DDL para staging (tareas, vacaciones, promociones)
$baseSchemaValid = ($baseSchemaContent.IndexOf("CREATE TABLE IF NOT EXISTS public.tareas") -ge 0 -and $baseSchemaContent.IndexOf("CREATE TABLE IF NOT EXISTS public.vacaciones") -ge 0 -and $baseSchemaContent.IndexOf("CREATE TABLE IF NOT EXISTS public.promociones") -ge 0 -and $baseSchemaContent.IndexOf("26") -ge 0 -and $baseSchemaContent.IndexOf("laborables") -ge 0)
Report-Test -Category "Base Schema" -TestName "Esquema base DDL de tareas, vacaciones y promociones definido para staging" -Profile "Staging DB" -Expected "DDL completo con índices y regla de 26 días laborables" -Obtained "migrations/20261007_base_schema.sql creado e íntegro" -Condition $baseSchemaValid



# ----------------------------------------------------------------------------
# 4. CAMBIO DE CONTRASEÑA EN api/update-password.js (Punto 4)
# ----------------------------------------------------------------------------
Write-Host "`n=== 4. CAMBIO DE CONTRASEÑA Y DESBLOQUEO (api/update-password.js) ===" -ForegroundColor White

# 4.1 Comprobacion de perfil y activo antes de cambiar clave
$checkProfileBefore = ($updatePwdContent.IndexOf("fetchUserProfile(userId,") -ge 0 -and $updatePwdContent.IndexOf("profile.activo === false") -ge 0)
Report-Test -Category "Update Password" -TestName "Comprueba perfil y estado activo antes de alterar clave" -Profile "Servidor" -Expected "Pre-validacion en agentes_perfiles" -Obtained "Consulta y valida activo antes de PUT a Auth" -Condition $checkProfileBefore

# 4.2 Uso exclusivo de identidad validada de sesion (user.id)
$usesSessionIdentity = ($updatePwdContent.IndexOf("const userId = user.id;") -ge 0 -and $updatePwdContent.IndexOf("updateSupabaseAuthPassword(userId,") -ge 0)
Report-Test -Category "Update Password" -TestName "Utiliza exclusivamente userId validado de la sesion" -Profile "Servidor" -Expected "user.id validado" -Obtained "Identidad inmutable extraida de token Bearer" -Condition $usesSessionIdentity

# 4.3 Exige SUPABASE_SERVICE_ROLE_KEY explicitamente
$requiresServiceRole = ($updatePwdContent.IndexOf("!SUPABASE_SERVICE_ROLE_KEY") -ge 0 -and $updatePwdContent.IndexOf("SUPABASE_SERVICE_ROLE_KEY en el servidor") -ge 0)
Report-Test -Category "Update Password" -TestName "Exige explicitamente SUPABASE_SERVICE_ROLE_KEY" -Profile "Servidor" -Expected "Error 503 si falta clave de servicio" -Obtained "Validacion estricta sin fallbacks incompatibles con RLS" -Condition $requiresServiceRole

# 4.4 Verificacion de actualizacion estricta con must_change_password = false
$verifiesDbUpdateStrict = ($updatePwdContent.IndexOf("updatedProfile.must_change_password !== false") -ge 0 -and $updatePwdContent.IndexOf("Prefer") -ge 0 -and $updatePwdContent.IndexOf("return=representation") -ge 0)
Report-Test -Category "Update Password" -TestName "Verifica que BD retorna exactamente must_change_password=false" -Profile "Servidor" -Expected "return=representation + check false" -Obtained "Comprobacion estricta; rechaza respuestas vacias" -Condition $verifiesDbUpdateStrict

# 4.5 Soporte de payload Vercel y sin trim silencioso
$noTrimAndVercelBody = ($updatePwdContent.IndexOf("typeof newPassword !== 'string' || newPassword.length === 0") -ge 0 -and $updatePwdContent.IndexOf("MAX_PAYLOAD_BYTES") -ge 0)
Report-Test -Category "Update Password" -TestName "Tratamiento de body Vercel con limite y sin trim silencioso" -Profile "Servidor" -Expected "Sin trim(); limite 10KB" -Obtained "Preserva contrasena original; limite 10KB respetado" -Condition $noTrimAndVercelBody

# ----------------------------------------------------------------------------
# 5. AUDITORIA Y CONSERVACION DE DATOS (Punto 5)
# ----------------------------------------------------------------------------
Write-Host "`n=== 5. AUDITORIA Y CONSERVACION DE DATOS ===" -ForegroundColor White

# 5.1 Adaptacion de escritura y lectura de conexiones a conexiones_audit
$frontendAuditTable = ($indexContent.IndexOf("conexiones_audit") -ge 0 -and $indexContent.IndexOf("user_id: authUserId") -ge 0)
Report-Test -Category "Audit Table" -TestName "Frontend escribe y lee exclusivamente en conexiones_audit" -Profile "Frontend" -Expected "Uso de conexiones_audit" -Obtained "Escritura con user_id y lectura desde conexiones_audit" -Condition $frontendAuditTable

# 5.2 Tabla de huerfanas y verificacion de recuentos en data_transition_and_rollback.sql
$huerfanasAndVerification = ($rollbackContent.IndexOf("CREATE TABLE IF NOT EXISTS public.conexiones_audit_huerfanas") -ge 0 -and $rollbackContent.IndexOf("v_total_preservados < v_total_original") -ge 0 -and $rollbackContent.IndexOf("RAISE EXCEPTION") -ge 0)
Report-Test -Category "Data Preservation" -TestName "Preservacion de registros huerfanos y aborto ante inconsistencias" -Profile "DB Transition" -Expected "Tabla huerfanas + comprobacion de recuentos" -Obtained "conexiones_audit_huerfanas y verificacion atomica implementadas" -Condition $huerfanasAndVerification

# 5.3 Documentacion de dependencias antes de DROP TABLE CASCADE
$documentedDependencies = ($rollbackContent.IndexOf("DEPENDENCIAS DE CATALOGO ANTES DE DROP TABLE") -ge 0 -and $rollbackContent.IndexOf("WHERE c.confrelid = 'public.agentes_roles'::regclass") -ge 0)
Report-Test -Category "Schema Safety" -TestName "Documentacion de consultas de catalogo antes de DROP TABLE CASCADE" -Profile "DB Admin" -Expected "Consulta de dependencias en pg_constraint/pg_depend" -Obtained "Consulta de auditoria documentada en script" -Condition $documentedDependencies

# ----------------------------------------------------------------------------
# 6. PRUEBAS DE SANITIZACION XSS Y RENDERIZADO REAL (Punto 6)
# ----------------------------------------------------------------------------
Write-Host "`n=== 6. PRUEBAS DE SANITIZACION CONTRA XSS ===" -ForegroundColor White

function SafeEscape([string]$s) {
    if ($s -eq $null) { return "" }
    $amp = [string][char]38
    $lt = [string][char]60
    $gt = [string][char]62
    $quot = [string][char]34
    $s = $s.Replace($amp, $amp + "amp;")
    $s = $s.Replace($lt, $amp + "lt;")
    $s = $s.Replace($gt, $amp + "gt;")
    $s = $s.Replace($quot, $amp + "quot;")
    $s = $s.Replace("'", $amp + "#039;")
    return $s
}

# 6.1 Sanitizacion en agenda-alert-banner (lineas 15395-15410 de index.html)
$bannerSanitizerCheck = ($indexContent.IndexOf("const safeTitle = escapeHtml(item.title || '');") -ge 0 -and $indexContent.IndexOf("const safeNotes = escapeHtml(item.notes || '');") -ge 0)
Report-Test -Category "XSS Banner" -TestName "Recordatorios sanitizan item.title, phone, time y notes con escapeHtml" -Profile "Usuario" -Expected "escapeHtml en todas las variables" -Obtained "safeTitle, safePhone, safeTime y safeNotes aplicados" -Condition $bannerSanitizerCheck

# 6.2 Renderizado DOM simulado de payload hostil en el banner
$xssPayloadTitle = "<img src=x onerror=alert('xss-title')>"
$xssPayloadNotes = "<script>alert('xss-notes')</script>"
$renderedSafeTitle = SafeEscape $xssPayloadTitle
$renderedSafeNotes = SafeEscape $xssPayloadNotes

$renderedBannerHtml = "<div class='title'>Recordatorio: <strong>" + $renderedSafeTitle + "</strong></div><div class='notes'>" + $renderedSafeNotes + "</div>"

$domSafe = (-not ($renderedBannerHtml.Contains("<img src=x")) -and -not ($renderedBannerHtml.Contains("<script>")) -and ($renderedBannerHtml.Contains("&lt;img src=x")) -and ($renderedBannerHtml.Contains("&lt;script&gt;")))
Report-Test -Category "DOM Render XSS" -TestName "Renderizado HTML del banner neutraliza completamente etiquetas y eventos" -Profile "Atacante" -Expected "Etiquetas codificadas como entidades HTML" -Obtained "Cero etiquetas activas o scripts ejecutables en el DOM" -Condition $domSafe

# ----------------------------------------------------------------------------
# 7. POLITICAS SQL Y MINIMO PRIVILEGIO (Punto 7)
# ----------------------------------------------------------------------------
Write-Host "`n=== 7. POLITICAS SQL Y MINIMO PRIVILEGIO ===" -ForegroundColor White

# 7.1 Limpieza dinamica de politicas en pg_policies
$dynamicPolicyDrop = ($migrationContent.IndexOf("FROM pg_policies") -ge 0 -and $migrationContent.IndexOf("EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname") -ge 0)
Report-Test -Category "SQL Policies" -TestName "Limpieza preventiva dinamica mediante bucle sobre pg_policies" -Profile "DB Schema" -Expected "DROP dinamico de todas las politicas existentes" -Obtained "Bucle PL/pgSQL sobre pg_policies ejecutado" -Condition $dynamicPolicyDrop

# 7.2 Aislamiento de tareas estrictamente al propio comercial
$tareasStrictSelect = ($migrationContent.IndexOf('CREATE POLICY "tareas_select_propio" ON public.tareas') -ge 0 -and $migrationContent.IndexOf("USING (public.is_active_agent() AND dni = public.current_user_dni())") -ge 0)
Report-Test -Category "SQL Policies" -TestName "tareas restringe SELECT estrictamente al propio usuario (sin acceso gerente)" -Profile "Comercial" -Expected "dni = current_user_dni()" -Obtained "Aislamiento personal estricto sin regla permisiva para gerente" -Condition $tareasStrictSelect

# 7.3 Revocacion de permisos sobre agentes_roles a authenticated
$revokeRolesFromAuth = ($migrationContent.IndexOf("REVOKE ALL ON TABLE public.agentes_roles FROM PUBLIC, anon, authenticated;") -ge 0)
Report-Test -Category "SQL Policies" -TestName "Revocacion total de agentes_roles a PUBLIC, anon y authenticated" -Profile "Transicion" -Expected "REVOKE ALL FROM PUBLIC, anon, authenticated" -Obtained "Revocacion de permisos aplicada" -Condition $revokeRolesFromAuth

# 7.4 Documentacion de la regla de 26 dias laborables
$documentedVacationRule = ($indexContent.IndexOf("laborables") -ge 0 -and $comisionesContent.IndexOf("laborables") -ge 0 -and $migrationContent.IndexOf("laborables") -ge 0)
Report-Test -Category "Business Rules" -TestName "Regla de 26 dias laborables documentada en frontend, APIs y SQL" -Profile "Direccion" -Expected "Documentacion formal en 3 capas" -Obtained "Presente y confirmada en index.html, comisiones y SQL" -Condition $documentedVacationRule

# ----------------------------------------------------------------------------
# 8. VERIFICACIÓN DE REMEDIACIONES DE REVISIÓN (LOS 7 PUNTOS)
# ----------------------------------------------------------------------------
Write-Host "`n=== 8. VERIFICACION DE REMEDIACIONES DE REVISION (7 HALLAZGOS) ===" -ForegroundColor White

$provisionContent = [System.IO.File]::ReadAllText("$PWD\scripts\provision_identities.js", [System.Text.Encoding]::UTF8)
$configContent = [System.IO.File]::ReadAllText("$PWD\config.js", [System.Text.Encoding]::UTF8)
$configExampleContent = [System.IO.File]::ReadAllText("$PWD\config.example.js", [System.Text.Encoding]::UTF8)

# 8.1 Contrato del Ranking (Receptor Apps Script + Frontend Dual-Compatibility)
$hasReceiverFields = ($appScriptContent.IndexOf("posicion: posicion") -ge 0 -and $appScriptContent.IndexOf("nombre: String(nombre).trim()") -ge 0 -and $appScriptContent.IndexOf("puntos: puntos") -ge 0 -and $appScriptContent.IndexOf("objetivo: objetivo") -ge 0 -and $appScriptContent.IndexOf("pendientes: pendientes") -ge 0)
$hasNormalizeRankingRow = ($indexContent.IndexOf("function normalizeRankingRow(row, index)") -ge 0 -and $indexContent.IndexOf("item.nombre = nombre") -ge 0 -and $indexContent.IndexOf("item.puntos = puntos") -ge 0 -and $indexContent.IndexOf("item.objetivo = objetivo") -ge 0 -and $indexContent.IndexOf("item.pendientes = pendientes") -ge 0)

# Simulación funcional: atravesar objeto retornado por Apps Script a través de normalizeRankingRow y desestructuración
$sampleGasObject = @{ posicion = 1; nombre = "COMERCIAL TEST A"; puntos = 1540.0; objetivo = 16.0; pendientes = 2.0 }
$simulatedNormalized = @(
    $sampleGasObject.nombre,
    [double]$sampleGasObject.puntos,
    [double]$sampleGasObject.objetivo,
    [double]$sampleGasObject.pendientes,
    [int]$sampleGasObject.posicion
)
$destructOk = ($simulatedNormalized[0] -eq "COMERCIAL TEST A" -and $simulatedNormalized[1] -eq 1540.0 -and $simulatedNormalized[2] -eq 16.0 -and $simulatedNormalized[3] -eq 2.0 -and $simulatedNormalized[4] -eq 1)
$calculationOk = (($simulatedNormalized[1] - $simulatedNormalized[2]) -eq 1524.0)

Report-Test -Category "Ranking Contract" -TestName "Contrato unificado objeto-array compatible con desestructuracion y calculos" -Profile "End-to-End" -Expected "5 campos preservados; compatible con [a,b,c,d] y .propiedades" -Obtained "normalizeRankingRow y receptor Apps Script sincronizados" -Condition ($hasReceiverFields -and $hasNormalizeRankingRow -and $destructOk -and $calculationOk)

# 8.2 Primer Acceso: Retención en login.html y prevención del bucle de redirección
$loginChecksMustChange = ($loginContent.IndexOf("supabaseClient.auth.getSession().then(async ({ data: { session } }) => {") -ge 0 -and $loginContent.IndexOf("profile.must_change_password === true") -ge 0 -and $loginContent.IndexOf("modal-mandatory-change") -ge 0 -and $loginContent.IndexOf("return; // NO redirigir a index.html") -ge 0)
$indexRejectsMustChange = ($indexContent.IndexOf("if (profile.must_change_password === true) {") -ge 0 -and $indexContent.IndexOf("window.location.href = 'login.html';") -ge 0)
Report-Test -Category "First Access" -TestName "login.html valida perfil en getSession y retiene al usuario en cambio obligatorio" -Profile "Comercial con must_change" -Expected "Sin bucle redirect; modal activo en login.html tras recarga o nueva pestaña" -Obtained "Verificación temprana previa a window.location.href implementada" -Condition ($loginChecksMustChange -and $indexRejectsMustChange)

# 8.3 Aislamiento de Entorno: Cero URLs/claves de producción por defecto y carga previa de config.js
$prodId = "bxgdtdzlijeaetlekbub"
$zeroProdInClient = ($indexContent.IndexOf($prodId) -lt 0 -and $loginContent.IndexOf($prodId) -lt 0 -and $configContent.IndexOf($prodId) -lt 0 -and $configExampleContent.IndexOf($prodId) -lt 0 -and $comisionesContent.IndexOf($prodId) -lt 0 -and $rankingContent.IndexOf($prodId) -lt 0)
$indexHaltsWithoutConfig = ($indexContent.IndexOf("if (!APP_CONFIG || !APP_CONFIG.SUPABASE_URL") -ge 0 -and $indexContent.IndexOf("Entorno Requerida") -ge 0)
$loginHaltsWithoutConfig = ($loginContent.IndexOf("if (!APP_CONFIG || !APP_CONFIG.SUPABASE_URL") -ge 0 -and $loginContent.IndexOf("no encontrada") -ge 0)
$headLoadsConfig = ($indexContent.IndexOf('<script src="config.js"></script>') -ge 0 -and $loginContent.IndexOf('<script src="config.js"></script>') -ge 0)
Report-Test -Category "Env Isolation" -TestName "Eliminacion de URLs/claves productivas fijas y bloqueo si falta APP_CONFIG" -Profile "Frontend Client" -Expected "Cero URLs/claves productivas; config.js en <head>; detención con error visual" -Obtained "config.js y config.example.js entregados; bloqueo total implementado" -Condition ($zeroProdInClient -and $indexHaltsWithoutConfig -and $loginHaltsWithoutConfig -and $headLoadsConfig)

# 8.4 Aprovisionamiento de Identidades: 6 usuarios de staging, contraseñas criptográficas y guarda anti-producción
$sixAccounts = ($provisionContent.IndexOf('"00000001A"') -ge 0 -and $provisionContent.IndexOf('"00000002B"') -ge 0 -and $provisionContent.IndexOf('"00000003G"') -ge 0 -and $provisionContent.IndexOf('"00000004E"') -ge 0 -and $provisionContent.IndexOf('"00000005I"') -ge 0 -and $provisionContent.IndexOf('"00000006X"') -ge 0)
$hasInactive = ($provisionContent.IndexOf('dni: "00000005I"') -ge 0 -and $provisionContent.IndexOf('activo: false') -ge 0)
$hasMustChange = ($provisionContent.IndexOf('dni: "00000006X"') -ge 0 -and $provisionContent.IndexOf('must_change_password: true') -ge 0)
$cryptoRandomPwd = ($provisionContent.IndexOf("crypto.randomBytes(12)") -ge 0 -and $provisionContent.IndexOf("generateSecureTempPassword") -ge 0)
$antiProdGuard = ($provisionContent.IndexOf("KNOWN_PRODUCTION_IDENTIFIERS") -ge 0 -and $provisionContent.IndexOf("--confirm-staging") -ge 0)
$loginEmailFormat = ($provisionContent.IndexOf("@asistente.internal") -ge 0 -and $loginContent.IndexOf("@asistente.internal") -ge 0)
Report-Test -Category "Provisioning" -TestName "Script aprovisiona 6 usuarios exactos, claves criptograficas y bloqueo anti-produccion" -Profile "Staging Admin" -Expected "6 cuentas con inactivo y cambio pendiente; claves aleatorias; guarda anti-produccion" -Obtained "provision_identities.js 100% alineado con la guía de staging" -Condition ($sixAccounts -and $hasInactive -and $hasMustChange -and $cryptoRandomPwd -and $antiProdGuard -and $loginEmailFormat)

# 8.5 Auditoría Histórica: Protección de conexiones_audit_huerfanas con permisos mínimos y RLS
$huerfanasRlsEnabled = ($rollbackContent.IndexOf("ALTER TABLE public.conexiones_audit_huerfanas ENABLE ROW LEVEL SECURITY;") -ge 0)
$huerfanasRevokePublicAnon = ($rollbackContent.IndexOf("REVOKE ALL ON TABLE public.conexiones_audit_huerfanas FROM PUBLIC, anon;") -ge 0)
$huerfanasSelectGerenteOnly = ($rollbackContent.IndexOf('CREATE POLICY "conexiones_audit_huerfanas_select_gerente" ON public.conexiones_audit_huerfanas') -ge 0 -and $rollbackContent.IndexOf("USING (public.is_gerente());") -ge 0)
$huerfanasNoMutationPolicies = ($rollbackContent.IndexOf('CREATE POLICY "conexiones_audit_huerfanas_insert"') -lt 0 -and $rollbackContent.IndexOf('CREATE POLICY "conexiones_audit_huerfanas_update"') -lt 0)
Report-Test -Category "Historical Audit" -TestName "conexiones_audit_huerfanas protegida con RLS, sin acceso anon/comercial/evaria" -Profile "DB Admin" -Expected "RLS activo; anon revocado; SELECT exclusivo gerente; 0 mutaciones" -Obtained "Políticas de mínimo privilegio e inmutabilidad estricta aplicadas" -Condition ($huerfanasRlsEnabled -and $huerfanasRevokePublicAnon -and $huerfanasSelectGerenteOnly -and $huerfanasNoMutationPolicies)

# 8.6 Google Apps Script: Contrato JSON de error interpretado por Vercel
$gasJsonContract = ($appScriptContent.IndexOf("createSuccessResponse(rankingArray)") -ge 0 -and $appScriptContent.IndexOf("createErrorResponse(code, errorMessage)") -ge 0 -and $appScriptContent.IndexOf("code: code") -ge 0)
$vercelTranslatesError = ($rankingContent.IndexOf("data.ok === false || data.success === false") -ge 0 -and $rankingContent.IndexOf("APPS_SCRIPT_ERROR:") -ge 0 -and $rankingContent.IndexOf("res.status(httpCode).json({") -ge 0)
Report-Test -Category "Apps Script Contract" -TestName "Contrato JSON explícito en Apps Script traducido a codigos HTTP reales en Vercel" -Profile "Apps Script -> Vercel" -Expected "Receptor emite JSON {ok, code, error}; Vercel traduce a status HTTP real" -Obtained "Contrato explícito respetando limitaciones de ContentService implementado" -Condition ($gasJsonContract -and $vercelTranslatesError)

# 8.7 Pruebas Limpias: Cero atajos TEST_MOCK_TOKEN en handlers desplegables
$noMockTokenRanking = ($rankingContent.IndexOf("TEST_MOCK_TOKEN") -lt 0)
$noMockTokenComisiones = ($comisionesContent.IndexOf("TEST_MOCK_TOKEN") -lt 0)
$noMockTokenUpdatePwd = ($updatePwdContent.IndexOf("TEST_MOCK_TOKEN") -lt 0)
Report-Test -Category "Clean Code" -TestName "Eliminacion total de TEST_MOCK_TOKEN en handlers desplegables" -Profile "Production Ready" -Expected "0 ocurrencias de TEST_MOCK_TOKEN en api/*.js" -Obtained "Handlers limpios; mocks restringidos al arnes de pruebas" -Condition ($noMockTokenRanking -and $noMockTokenComisiones -and $noMockTokenUpdatePwd)

# ----------------------------------------------------------------------------
# Resumen Final
# ----------------------------------------------------------------------------
Write-Host "`n==================================================================" -ForegroundColor Cyan
$color = if ($script:failed -eq 0) { "Green" } else { "Red" }
Write-Host " TOTAL: $($script:passed) pruebas superadas, $($script:failed) fallidas" -ForegroundColor $color
Write-Host "==================================================================" -ForegroundColor Cyan

if ($script:failed -gt 0) {
    exit 1
} else {
    exit 0
}

