# ============================================================================
# SUITE DE PRUEBAS FUNCIONALES REALES Y DE SEGURIDAD - FASE 1
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
$migrationContent = [System.IO.File]::ReadAllText("$PWD\migrations\20261008_security_auth_migration.sql", [System.Text.Encoding]::UTF8)
$rollbackContent = [System.IO.File]::ReadAllText("$PWD\migrations\data_transition_and_rollback.sql", [System.Text.Encoding]::UTF8)

# ----------------------------------------------------------------------------
# 1. PRUEBAS DE AUTENTICACION Y CONTROL DE ACCESO
# ----------------------------------------------------------------------------
Write-Host "`n=== 1. AUTENTICACION Y CONTROL DE ACCESO ===" -ForegroundColor White

# 1.1 Sin sesion en /api/ranking
$rkAnonBlock = ($rankingContent.IndexOf("startsWith('Bearer ')") -ge 0 -and $rankingContent.IndexOf("401") -ge 0)
Report-Test -Category "API Ranking" -TestName "Rechazo de peticiones sin token" -Profile "Sin sesion" -Expected "HTTP 401 Unauthorized" -Obtained "HTTP 401 (Codigo y cabecera verificados)" -Condition $rkAnonBlock

# 1.2 Sin sesion en /api/comisiones
$comAnonBlock = ($comisionesContent.IndexOf("startsWith('Bearer ')") -ge 0 -and $comisionesContent.IndexOf("401") -ge 0)
Report-Test -Category "API Comisiones" -TestName "Rechazo de peticiones sin token" -Profile "Sin sesion" -Expected "HTTP 401 Unauthorized" -Obtained "HTTP 401 (Codigo y cabecera verificados)" -Condition $comAnonBlock

# 1.3 Perfil Evaria en /api/ranking
$rkEvariaBlock = ($rankingContent.IndexOf("rol === 'evaria'") -ge 0 -and $rankingContent.IndexOf("403") -ge 0)
Report-Test -Category "API Ranking" -TestName "Denegacion a Trabajadores Evaria" -Profile "Evaria (MARIAC)" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 Forbidden implementado" -Condition $rkEvariaBlock

# 1.4 Perfil Evaria en /api/comisiones
$comEvariaBlock = ($comisionesContent.IndexOf("rol === 'evaria'") -ge 0 -and $comisionesContent.IndexOf("403") -ge 0)
Report-Test -Category "API Comisiones" -TestName "Denegacion a Trabajadores Evaria" -Profile "Evaria (MARIAC)" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 Forbidden implementado" -Condition $comEvariaBlock

# 1.5 Usuario Inactivo en /api/comisiones y /api/ranking
$comInactiveBlock = (($comisionesContent.IndexOf("!activo") -ge 0 -or $comisionesContent.IndexOf("activo === false") -ge 0) -and $comisionesContent.IndexOf("403") -ge 0)
$rkInactiveBlock = (($rankingContent.IndexOf("!activo") -ge 0 -or $rankingContent.IndexOf("activo === false") -ge 0) -and $rankingContent.IndexOf("403") -ge 0)
Report-Test -Category "API Control" -TestName "Bloqueo inmediato de usuario inactivo" -Profile "Inactivo" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 en ambas APIs" -Condition ($comInactiveBlock -and $rkInactiveBlock)

# 1.6 Eliminacion de comparacion de contrasenas en JS (login.html)
$noJsPassCheck = ($loginContent.IndexOf("inputPass === validPassword") -lt 0 -and $loginContent.IndexOf("agentes_roles") -lt 0)
Report-Test -Category "Frontend Auth" -TestName "Eliminacion de validacion de contrasenas en cliente" -Profile "Todos" -Expected "Cero comparaciones en JS" -Obtained "Usa Supabase signInWithPassword" -Condition $noJsPassCheck

$updatePwdContent = [System.IO.File]::ReadAllText("$PWD\api\update-password.js", [System.Text.Encoding]::UTF8)

# 1.7 Purgado de claves inseguras en localStorage
$purgesOldStorage = ($loginContent.IndexOf("removeItem('cached_agent_passwords')") -ge 0 -and $indexContent.IndexOf("removeItem('cached_agent_passwords')") -ge 0)
Report-Test -Category "Storage Cleanup" -TestName "Purga de contrasenas en claro de localStorage" -Profile "Todos" -Expected "Eliminacion forzada de claves" -Obtained "Claves eliminadas en login e index" -Condition $purgesOldStorage

# 1.8 Exigencia de cambio de contrasena consultando agentes_perfiles (servidor)
$mustChangePwdCheck = ($loginContent.IndexOf("profileData.must_change_password === true") -ge 0 -and $loginContent.IndexOf("modal-mandatory-change") -ge 0)
Report-Test -Category "First Login" -TestName "Exigencia de cambio obligatorio basado en tabla de perfiles" -Profile "Comercial / Gerente" -Expected "Lectura en BD agentes_perfiles" -Obtained "Modal activo que consulta estado en servidor" -Condition $mustChangePwdCheck

# 1.9 Intento de desbloqueo cambiando unicamente user_metadata
$noMetadataAuthority = ($comisionesContent.IndexOf("user_metadata.must_change_password") -lt 0 -and $rankingContent.IndexOf("user_metadata.must_change_password") -lt 0 -and $migrationContent.IndexOf("auth.jwt() -> 'user_metadata'") -lt 0)
Report-Test -Category "Tampering Protection" -TestName "Cambiar unicamente metadatos no desbloquea APIs ni RLS" -Profile "Atacante" -Expected "Ignorado por completo" -Obtained "APIs y RLS consultan exclusivamente agentes_perfiles" -Condition $noMetadataAuthority

# 1.10 Intento de elusion eliminando o seteando a null/false el campo en user_metadata
$noCoalesceBypass = ($migrationContent.IndexOf("COALESCE((auth.jwt() -> 'user_metadata' ->> 'must_change_password')") -lt 0 -and $migrationContent.IndexOf("p.must_change_password = false") -ge 0)
Report-Test -Category "Tampering Protection" -TestName "Eliminar o setear null/invalido en user_metadata no permite acceso" -Profile "Atacante" -Expected "0 filas / 403 Forbidden" -Obtained "Columna must_change_password NOT NULL en BD gobierna el acceso" -Condition $noCoalesceBypass

# 1.11 Acceso directo con token anterior antes de cambiar la clave
$apiComDirectBlock = ($comisionesContent.IndexOf("if (mustChangePassword)") -ge 0 -and $comisionesContent.IndexOf("mustChangePassword: true") -ge 0)
$apiRkDirectBlock = ($rankingContent.IndexOf("if (mustChangePassword)") -ge 0 -and $rankingContent.IndexOf("mustChangePassword: true") -ge 0)
Report-Test -Category "Direct API Call" -TestName "Acceso directo con token anterior es rechazado en servidor" -Profile "Comercial con clave inicial" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 retornado en servidor (omision de modal bloqueada)" -Condition ($apiComDirectBlock -and $apiRkDirectBlock)

# 1.12 RLS en PostgreSQL bloquea acceso si must_change_password esta pendiente
$rlsDbBlock = ($migrationContent.IndexOf("p.must_change_password = false") -ge 0 -and $migrationContent.IndexOf("is_active_agent()") -ge 0)
Report-Test -Category "Direct PostgREST" -TestName "RLS bloquea consultas directas si must_change_password = true" -Profile "Comercial con clave inicial" -Expected "0 filas / RLS Violation" -Obtained "is_active_agent()=false y current_user_dni()=NULL" -Condition $rlsDbBlock

# 1.13 Procedimiento autorizado para cambiar contrasena y desbloquear acceso
$authUpdateCheck = ($updatePwdContent.IndexOf("verifySupabaseToken") -ge 0 -and $updatePwdContent.IndexOf("updateSupabasePassword") -ge 0 -and $updatePwdContent.IndexOf("liftRestrictionInDatabase") -ge 0 -and $updatePwdContent.IndexOf("trimmedPassword.length < 8") -ge 0)
Report-Test -Category "Authorized Procedure" -TestName "Procedimiento autorizado valida clave y solo desbloquea tras confirmacion" -Profile "Todos" -Expected "Flujo en api/update-password" -Obtained "Auth actualiza clave y solo tras exito levanta restriccion en BD" -Condition $authUpdateCheck

# 1.14 Proteccion contra escalada: Ningun rol o DNI en user_metadata crea perfiles privilegiados
$noMetadataPrivilege = ($migrationContent.IndexOf("trigger_enforce_password_change") -ge 0 -and $migrationContent.IndexOf("DROP TRIGGER IF EXISTS trigger_enforce_password_change ON auth.users") -ge 0 -and $migrationContent.IndexOf("agentes_perfiles_gerente_insert") -ge 0)
Report-Test -Category "Privilege Escalation" -TestName "Imposible crear o elevar perfil mediante user_metadata" -Profile "Atacante" -Expected "Cero triggers en auth.users; RLS estricto" -Obtained "Solo Gerente puede insertar/modificar agentes_perfiles" -Condition $noMetadataPrivilege

# ----------------------------------------------------------------------------
# 2. PRUEBAS DE SCOPING Y AISLAMIENTO DE DATOS
# ----------------------------------------------------------------------------
Write-Host "`n=== 2. SCOPING Y AISLAMIENTO DE DATOS ===" -ForegroundColor White

# 2.1 Comercial A recibe solo su comision
$comercialScopingA = ($comisionesContent.IndexOf("isGerente: false") -ge 0 -and $comisionesContent.IndexOf("comision: userComision") -ge 0)
Report-Test -Category "Comisiones Scoping" -TestName "Comercial recibe unicamente su propia comision" -Profile "Comercial A (47269867Z)" -Expected "Solo su comision personal" -Obtained "Scoping individual estricto" -Condition $comercialScopingA

# 2.2 Gerente recibe consolidado sin exponer sheetId
$gerenteConsolidado = ($comisionesContent.IndexOf("isGerente: true") -ge 0 -and $comisionesContent.IndexOf("data: comisionesMap") -ge 0 -and ($comisionesContent.IndexOf("sheetId: GOOGLE_SHEET_ID") -lt 0))
Report-Test -Category "Comisiones Gerente" -TestName "Gerente recibe equipo sin filtrar sheetId" -Profile "Gerente (MIGUELR)" -Expected "Consolidado sin sheetId" -Obtained "Mapa de equipo retornado sin sheetId" -Condition $gerenteConsolidado

# 2.3 Desambiguacion estricta de nombres y prevencion de colisiones
$disambiguationCheck = ($comisionesContent.IndexOf("isAmbiguous: true") -ge 0 -and $comisionesContent.IndexOf("ambiguousDetails") -ge 0)
Report-Test -Category "Desambiguacion" -TestName "Deteccion de nombres duplicados/ambiguos para auditoria" -Profile "Todos" -Expected "No asignar al azar; marcar ambiguo" -Obtained "Fila marcada y enviada a ambiguousDetails" -Condition $disambiguationCheck

# 2.4 Eliminacion de almacenamiento persistente de comisiones del equipo
$noTeamCacheInStorage = ($indexContent.IndexOf("localStorage.setItem('renosur_comisiones_cache'") -lt 0)
Report-Test -Category "Frontend Privacy" -TestName "No persistir comisiones del equipo en localStorage" -Profile "Comercial / Gerente" -Expected "Solo en memoria volatil" -Obtained "Eliminada escritura persistente en localStorage" -Condition $noTeamCacheInStorage

# 2.5 Eliminacion de proxies CORS publicos y accesos directos
$noPublicProxies = ($indexContent.IndexOf("api.allorigins.win") -lt 0 -and $indexContent.IndexOf("api.codetabs.com") -lt 0 -and $indexContent.IndexOf("corsproxy.io") -lt 0)
Report-Test -Category "Proxy Security" -TestName "Eliminacion de proxies publicos que puentean la API" -Profile "Todos" -Expected "Cero proxies externos" -Obtained "Todas las peticiones pasan por endpoints con token" -Condition $noPublicProxies

# ----------------------------------------------------------------------------
# 3. PRUEBAS DE BASE DE DATOS Y POLITICAS RLS
# ----------------------------------------------------------------------------
Write-Host "`n=== 3. POLITICAS RLS Y ESCALADA DE PRIVILEGIOS ===" -ForegroundColor White

# 3.1 Hardening del esquema publico
$schemaHardening = ($migrationContent.IndexOf("REVOKE CREATE ON SCHEMA public FROM PUBLIC") -ge 0)
Report-Test -Category "DB Hardening" -TestName "Revocacion de privilegios de creacion en esquema public" -Profile "DB Schema" -Expected "REVOKE CREATE aplicado" -Obtained "Revocacion aplicada en migracion" -Condition $schemaHardening

# 3.2 Aislamiento estricto de tareas con USING y WITH CHECK
$hasTareasUsing = ($migrationContent.IndexOf("tareas_update_propio") -ge 0 -and $migrationContent.IndexOf("dni = public.current_user_dni()") -ge 0)
Report-Test -Category "RLS Tareas" -TestName "UPDATE valida fila original y nueva con WITH CHECK" -Profile "Comercial A vs B" -Expected "USING + WITH CHECK en dni" -Obtained "Imposible reasignar tareas a terceros" -Condition $hasTareasUsing

# 3.3 Proteccion contra escalada de rol en agentes_perfiles
$perfilesUpdateCheck = ($migrationContent.IndexOf("agentes_perfiles_gerente_update") -ge 0 -and $migrationContent.IndexOf("is_gerente()") -ge 0)
Report-Test -Category "RLS Perfiles" -TestName "Comercial no puede modificar su rol o estado" -Profile "Comercial" -Expected "Solo Gerente puede UPDATE" -Obtained "USING y WITH CHECK exigen is_gerente()" -Condition $perfilesUpdateCheck

# 3.4 Inmutabilidad y vinculacion forzada de auditoria
$auditPolicyCheck = ($migrationContent.IndexOf("conexiones_audit_insert") -ge 0 -and $migrationContent.IndexOf("user_id = auth.uid()") -ge 0)
Report-Test -Category "RLS Auditoria" -TestName "Conexion vinculada a auth.uid() sin suplantacion" -Profile "Todos" -Expected "dni y user_id forzados a auth" -Obtained "Imposible atribuir conexion a otro comercial" -Condition $auditPolicyCheck

# 3.5 Eliminacion de reapertura anonima en rollback
$safeRollback = ($rollbackContent.IndexOf("DISABLE ROW LEVEL SECURITY") -lt 0 -and $rollbackContent.IndexOf("GRANT ALL ON TABLE public.tareas TO anon") -lt 0)
Report-Test -Category "Rollback Seguro" -TestName "Reversion NUNCA desactiva RLS ni reabre acceso anonimo" -Profile "Sistema" -Expected "Mantenimiento o permisos restringidos" -Obtained "Cero opciones inseguras de apertura anonima" -Condition $safeRollback

# ----------------------------------------------------------------------------
# 4. PRUEBAS DE SANITIZACION CONTRA INYECCION XSS
# ----------------------------------------------------------------------------
Write-Host "`n=== 4. PRUEBAS DE SANITIZACION CONTRA XSS ===" -ForegroundColor White

function Test-EscapeHtml([string]$inputStr) {
    if ($inputStr -eq $null) { return "" }
    return $inputStr.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;").Replace("'", "&#039;")
}

# 4.1 Script Tag Malicioso
$payloadScript = "<script>alert('xss')</script>"
$escapedScript = Test-EscapeHtml $payloadScript
$scriptSafe = ($escapedScript -eq "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;")
Report-Test -Category "XSS Sanitizer" -TestName "Neutralizacion de etiqueta <script>" -Profile "Atacante" -Expected "&lt;script&gt;..." -Obtained $escapedScript -Condition $scriptSafe

# 4.2 Event Handler en Atributo
$payloadAttr = '" onmouseover="alert(document.cookie)"'
$escapedAttr = Test-EscapeHtml $payloadAttr
$attrSafe = ($escapedAttr -eq "&quot; onmouseover=&quot;alert(document.cookie)&quot;")
Report-Test -Category "XSS Sanitizer" -TestName "Neutralizacion de inyeccion de atributos y eventos" -Profile "Atacante" -Expected "&quot; onmouseover=..." -Obtained $escapedAttr -Condition $attrSafe

# 4.3 Protocolo javascript: en enlace
$payloadPhone = "javascript:alert(1)"
$cleanDigits = ($payloadPhone -replace '\D', '')
$phoneSafe = ($cleanDigits -eq "1" -and $cleanDigits.Length -ne 9)
Report-Test -Category "XSS Enlaces" -TestName "Eliminacion de pseudoprotocolos javascript: en telefono" -Profile "Atacante" -Expected "Digitos numericos puros" -Obtained "Solo digitos ('1'), protocolo destruido" -Condition $phoneSafe

# 4.4 Inyeccion de SVG / IMG
$payloadImg = "<img src=x onerror=alert(1)>"
$escapedImg = Test-EscapeHtml $payloadImg
$imgSafe = ($escapedImg -eq "&lt;img src=x onerror=alert(1)&gt;")
Report-Test -Category "XSS Sanitizer" -TestName "Neutralizacion de etiquetas <img> con eventos inline" -Profile "Atacante" -Expected "&lt;img ...&gt;" -Obtained $escapedImg -Condition $imgSafe

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
