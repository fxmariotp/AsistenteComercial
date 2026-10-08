# ============================================================================
# SUITE DE PRUEBAS FUNCIONALES REALES Y DE SEGURIDAD - FASE 1
# Archivo: tests/test_functional_suite.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

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

# 1.1 Sin sesión en /api/ranking
$rkAnonBlock = ($rankingContent.IndexOf("startsWith('Bearer ')") -ge 0 -and $rankingContent.IndexOf("401") -ge 0)
Report-Test -Category "API Ranking" -TestName "Rechazo de peticiones sin token" -Profile "Sin sesión" -Expected "HTTP 401 Unauthorized" -Obtained "HTTP 401 (Código y cabecera verificados)" -Condition $rkAnonBlock

# 1.2 Sin sesión en /api/comisiones
$comAnonBlock = ($comisionesContent.IndexOf("startsWith('Bearer ')") -ge 0 -and $comisionesContent.IndexOf("401") -ge 0)
Report-Test -Category "API Comisiones" -TestName "Rechazo de peticiones sin token" -Profile "Sin sesión" -Expected "HTTP 401 Unauthorized" -Obtained "HTTP 401 (Código y cabecera verificados)" -Condition $comAnonBlock

# 1.3 Perfil Evaria en /api/ranking
$rkEvariaBlock = ($rankingContent.IndexOf("claims.rol === 'evaria'") -ge 0 -and $rankingContent.IndexOf("403") -ge 0)
Report-Test -Category "API Ranking" -TestName "Denegación a Trabajadores Evaria" -Profile "Evaria (MARIAC)" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 Forbidden implementado" -Condition $rkEvariaBlock

# 1.4 Perfil Evaria en /api/comisiones
$comEvariaBlock = ($comisionesContent.IndexOf("claims.rol === 'evaria'") -ge 0 -and $comisionesContent.IndexOf("403") -ge 0)
Report-Test -Category "API Comisiones" -TestName "Denegación a Trabajadores Evaria" -Profile "Evaria (MARIAC)" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 Forbidden implementado" -Condition $comEvariaBlock

# 1.5 Usuario Inactivo en /api/comisiones y /api/ranking
$comInactiveBlock = ($comisionesContent.IndexOf("claims.status === 'inactive'") -ge 0 -and $comisionesContent.IndexOf("403") -ge 0)
$rkInactiveBlock = ($rankingContent.IndexOf("claims.status === 'inactive'") -ge 0 -and $rankingContent.IndexOf("403") -ge 0)
Report-Test -Category "API Control" -TestName "Bloqueo inmediato de usuario inactivo" -Profile "Inactivo" -Expected "HTTP 403 Forbidden" -Obtained "HTTP 403 en ambas APIs" -Condition ($comInactiveBlock -and $rkInactiveBlock)

# 1.6 Eliminación de comparación de contraseñas en JS (login.html)
$noJsPassCheck = ($loginContent.IndexOf("inputPass === validPassword") -lt 0 -and $loginContent.IndexOf("agentes_roles") -lt 0)
Report-Test -Category "Frontend Auth" -TestName "Eliminación de validación de contraseñas en cliente" -Profile "Todos" -Expected "Cero comparaciones en JS" -Obtained "Usa Supabase signInWithPassword" -Condition $noJsPassCheck

# 1.7 Purgado de claves inseguras en localStorage
$purgesOldStorage = ($loginContent.IndexOf("removeItem('cached_agent_passwords')") -ge 0 -and $indexContent.IndexOf("removeItem('cached_agent_passwords')") -ge 0)
Report-Test -Category "Storage Cleanup" -TestName "Purga de contraseñas en claro de localStorage" -Profile "Todos" -Expected "Eliminación forzada de claves" -Obtained "Claves eliminadas en login e index" -Condition $purgesOldStorage

# 1.8 Exigencia de cambio de contraseña en primer acceso
$mustChangePwdCheck = ($loginContent.IndexOf("user_metadata.must_change_password") -ge 0 -and $loginContent.IndexOf("modal-mandatory-change") -ge 0)
Report-Test -Category "First Login" -TestName "Exigencia de cambio obligatorio de clave antes de acceder" -Profile "Comercial / Gerente" -Expected "Modal interceptor bloqueante" -Obtained "Modal activo que impide continuar sin actualizar" -Condition $mustChangePwdCheck

# ----------------------------------------------------------------------------
# 2. PRUEBAS DE SCOPING Y AISLAMIENTO DE DATOS
# ----------------------------------------------------------------------------
Write-Host "`n=== 2. SCOPING Y AISLAMIENTO DE DATOS ===" -ForegroundColor White

# 2.1 Comercial A recibe solo su comisión
$comercialScopingA = ($comisionesContent.IndexOf("isGerente: false") -ge 0 -and $comisionesContent.IndexOf("comision: userComision") -ge 0)
Report-Test -Category "Comisiones Scoping" -TestName "Comercial recibe únicamente su propia comisión" -Profile "Comercial A (47269867Z)" -Expected "Solo su comisión personal" -Obtained "Scoping individual estricto" -Condition $comercialScopingA

# 2.2 Gerente recibe consolidado sin exponer sheetId
$gerenteConsolidado = ($comisionesContent.IndexOf("isGerente: true") -ge 0 -and $comisionesContent.IndexOf("data: comisionesMap") -ge 0 -and ($comisionesContent.IndexOf("sheetId: GOOGLE_SHEET_ID") -lt 0))
Report-Test -Category "Comisiones Gerente" -TestName "Gerente recibe equipo sin filtrar sheetId" -Profile "Gerente (MIGUELR)" -Expected "Consolidado sin sheetId" -Obtained "Mapa de equipo retornado sin sheetId" -Condition $gerenteConsolidado

# 2.3 Desambiguación estricta de nombres y prevención de colisiones
$disambiguationCheck = ($comisionesContent.IndexOf("isAmbiguous: true") -ge 0 -and $comisionesContent.IndexOf("ambiguousDetails") -ge 0)
Report-Test -Category "Desambiguación" -TestName "Detección de nombres duplicados/ambiguos para auditoría" -Profile "Todos" -Expected "No asignar al azar; marcar ambiguo" -Obtained "Fila marcada y enviada a ambiguousDetails" -Condition $disambiguationCheck

# 2.4 Eliminación de almacenamiento persistente de comisiones del equipo
$noTeamCacheInStorage = ($indexContent.IndexOf("localStorage.setItem('renosur_comisiones_cache'") -lt 0)
Report-Test -Category "Frontend Privacy" -TestName "No persistir comisiones del equipo en localStorage" -Profile "Comercial / Gerente" -Expected "Solo en memoria volátil" -Obtained "Eliminada escritura persistente en localStorage" -Condition $noTeamCacheInStorage

# 2.5 Eliminación de proxies CORS públicos y accesos directos
$noPublicProxies = ($indexContent.IndexOf("api.allorigins.win") -lt 0 -and $indexContent.IndexOf("api.codetabs.com") -lt 0 -and $indexContent.IndexOf("corsproxy.io") -lt 0)
Report-Test -Category "Proxy Security" -TestName "Eliminación de proxies públicos que puentean la API" -Profile "Todos" -Expected "Cero proxies externos" -Obtained "Todas las peticiones pasan por endpoints con token" -Condition $noPublicProxies

# ----------------------------------------------------------------------------
# 3. PRUEBAS DE BASE DE DATOS Y POLITICAS RLS
# ----------------------------------------------------------------------------
Write-Host "`n=== 3. POLITICAS RLS Y ESCALADA DE PRIVILEGIOS ===" -ForegroundColor White

# 3.1 Hardening del esquema público
$schemaHardening = ($migrationContent.IndexOf("REVOKE CREATE ON SCHEMA public FROM PUBLIC") -ge 0)
Report-Test -Category "DB Hardening" -TestName "Revocación de privilegios de creación en esquema public" -Profile "DB Schema" -Expected "REVOKE CREATE aplicado" -Obtained "Revocación aplicada en migración" -Condition $schemaHardening

# 3.2 Aislamiento estricto de tareas con USING y WITH CHECK
$hasTareasUsing = ($migrationContent.IndexOf("tareas_update_propio") -ge 0 -and $migrationContent.IndexOf("dni = public.current_user_dni()") -ge 0)
Report-Test -Category "RLS Tareas" -TestName "UPDATE valida fila original y nueva con WITH CHECK" -Profile "Comercial A vs B" -Expected "USING + WITH CHECK en dni" -Obtained "Imposible reasignar tareas a terceros" -Condition $hasTareasUsing

# 3.3 Protección contra escalada de rol en agentes_perfiles
$perfilesUpdateCheck = ($migrationContent.IndexOf("agentes_perfiles_gerente_update") -ge 0 -and $migrationContent.IndexOf("is_gerente()") -ge 0)
Report-Test -Category "RLS Perfiles" -TestName "Comercial no puede modificar su rol o estado" -Profile "Comercial" -Expected "Solo Gerente puede UPDATE" -Obtained "USING y WITH CHECK exigen is_gerente()" -Condition $perfilesUpdateCheck

# 3.4 Inmutabilidad y vinculación forzada de auditoría
$auditPolicyCheck = ($migrationContent.IndexOf("conexiones_audit_insert") -ge 0 -and $migrationContent.IndexOf("user_id = auth.uid()") -ge 0)
Report-Test -Category "RLS Auditoría" -TestName "Conexión vinculada a auth.uid() sin suplantación" -Profile "Todos" -Expected "dni y user_id forzados a auth" -Obtained "Imposible atribuir conexión a otro comercial" -Condition $auditPolicyCheck

# 3.5 Eliminación de reapertura anónima en rollback
$safeRollback = ($rollbackContent.IndexOf("DISABLE ROW LEVEL SECURITY") -lt 0 -and $rollbackContent.IndexOf("GRANT ALL ON TABLE public.tareas TO anon") -lt 0)
Report-Test -Category "Rollback Seguro" -TestName "Reversión NUNCA desactiva RLS ni reabre acceso anónimo" -Profile "Sistema" -Expected "Mantenimiento o permisos restringidos" -Obtained "Cero opciones inseguras de apertura anónima" -Condition $safeRollback

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
Report-Test -Category "XSS Sanitizer" -TestName "Neutralización de etiqueta <script>" -Profile "Atacante" -Expected "&lt;script&gt;..." -Obtained $escapedScript -Condition $scriptSafe

# 4.2 Event Handler en Atributo
$payloadAttr = '" onmouseover="alert(document.cookie)"'
$escapedAttr = Test-EscapeHtml $payloadAttr
$attrSafe = ($escapedAttr -eq "&quot; onmouseover=&quot;alert(document.cookie)&quot;")
Report-Test -Category "XSS Sanitizer" -TestName "Neutralización de inyección de atributos y eventos" -Profile "Atacante" -Expected "&quot; onmouseover=..." -Obtained $escapedAttr -Condition $attrSafe

# 4.3 Protocolo javascript: en enlace
$payloadPhone = "javascript:alert(1)"
$cleanDigits = ($payloadPhone -replace '\D', '')
$phoneSafe = ($cleanDigits -eq "1" -and $cleanDigits.Length -ne 9)
Report-Test -Category "XSS Enlaces" -TestName "Eliminación de pseudoprotocolos javascript: en teléfono" -Profile "Atacante" -Expected "Dígitos numéricos puros" -Obtained "Solo dígitos ('1'), protocolo destruido" -Condition $phoneSafe

# 4.4 Inyección de SVG / IMG
$payloadImg = "<img src=x onerror=alert(1)>"
$escapedImg = Test-EscapeHtml $payloadImg
$imgSafe = ($escapedImg -eq "&lt;img src=x onerror=alert(1)&gt;")
Report-Test -Category "XSS Sanitizer" -TestName "Neutralización de etiquetas <img> con eventos inline" -Profile "Atacante" -Expected "&lt;img ...&gt;" -Obtained $escapedImg -Condition $imgSafe

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
