# ============================================================================
# BATERÍA DE PRUEBAS DE SEGURIDAD Y VALIDACIÓN - FASE 1
# Archivo: tests/test_security_phase1.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " EJECUTANDO PRUEBAS DE SEGURIDAD - FASE 1 (ASISTENTE COMERCIAL)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$script:passedCount = 0
$script:failedCount = 0

function Assert-Check {
    param(
        [string]$testName,
        [bool]$condition,
        [string]$details = ""
    )
    if ($condition) {
        Write-Host " [PASS] $testName" -ForegroundColor Green
        if ($details -ne "") { Write-Host "        $details" -ForegroundColor Gray }
        $script:passedCount++
    } else {
        Write-Host " [FAIL] $testName" -ForegroundColor Red
        if ($details -ne "") { Write-Host "        $details" -ForegroundColor Yellow }
        $script:failedCount++
    }
}

# Carga de archivos con codificación UTF-8 explícita
$indexContent = [System.IO.File]::ReadAllText("$PWD\index.html", [System.Text.Encoding]::UTF8)
$loginContent = [System.IO.File]::ReadAllText("$PWD\login.html", [System.Text.Encoding]::UTF8)
$comisionesContent = [System.IO.File]::ReadAllText("$PWD\api\comisiones.js", [System.Text.Encoding]::UTF8)
$rankingContent = [System.IO.File]::ReadAllText("$PWD\api\ranking.js", [System.Text.Encoding]::UTF8)

# ----------------------------------------------------------------------------
# 1. Regla de negocio de vacaciones
# ----------------------------------------------------------------------------
Write-Host "`n--- 1. REGLA DE NEGOCIO DE VACACIONES ---" -ForegroundColor White
$hasVacationRule = ($indexContent -match "26 d[ií]as laborables" -or $indexContent -match "26 d.*as laborables")
Assert-Check -testName "Regla de 26 dias laborables documentada en index.html" -condition $hasVacationRule -details "Comprobado en cabecera del script de index.html"

# ----------------------------------------------------------------------------
# 2. Sanitización contra XSS en index.html
# ----------------------------------------------------------------------------
Write-Host "`n--- 2. SANITIZACION CONTRA INYECCION XSS ---" -ForegroundColor White

$hasEscapeHtml = ($indexContent -match "function escapeHtml\(str\)")
Assert-Check -testName "Funcion escapeHtml implementada en frontend" -condition $hasEscapeHtml

$hasAgendaEscape = ($indexContent -match "escapeHtml\(item\.title\)" -and $indexContent -match "escapeHtml\(item\.notes\)")
Assert-Check -testName "Agenda sanitiza item.title y item.notes con escapeHtml" -condition $hasAgendaEscape

$hasWaPhoneSanitize = ($indexContent -match "encodeURIComponent\(waPhone\)")
Assert-Check -testName "Enlace de WhatsApp Web valida formato y codifica telefono" -condition $hasWaPhoneSanitize

$hasLogsEscape = ($indexContent -match "safeName = escapeHtml\(name\)" -and $indexContent -match "safeIp = escapeHtml\(displayPublicIp\)")
Assert-Check -testName "Registro de conexiones escapa variables dinamicas de usuario" -condition $hasLogsEscape

# ----------------------------------------------------------------------------
# 3. Control de navegación por rol en frontend (Defense in Depth)
# ----------------------------------------------------------------------------
Write-Host "`n--- 3. CONTROL DE NAVEGACION EN FRONTEND ---" -ForegroundColor White

$hasRoleGuard = ($indexContent -match "gerentePanels\s*=\s*\[.*gerenteHub" -and $indexContent -match "userRole !== 'gerente'")
Assert-Check -testName "Guardia de rol en funcion showPanel implementado" -condition $hasRoleGuard -details "Bloquea paneles administrativos (gerenteHub, etc.) a perfiles no gerente"

# ----------------------------------------------------------------------------
# 4. Seguridad y Scoping en /api/comisiones
# ----------------------------------------------------------------------------
Write-Host "`n--- 4. PROTECCION Y SCOPING EN /api/comisiones ---" -ForegroundColor White

$hasBearerCheck = ($comisionesContent -match "startsWith\('Bearer '\)")
Assert-Check -testName "api/comisiones exige cabecera Authorization Bearer" -condition $hasBearerCheck

$hasSupabaseAuthVerification = ($comisionesContent -match "/auth/v1/user")
Assert-Check -testName "api/comisiones valida criptograficamente el token con Supabase Auth" -condition $hasSupabaseAuthVerification

$hasEvariaCheck = ($comisionesContent -match "rol === 'evaria'" -and $comisionesContent -match "403")
Assert-Check -testName "api/comisiones deniega acceso a perfil Evaria con HTTP 403" -condition $hasEvariaCheck

$hasComercialScoping = ($comisionesContent -match "rol === 'gerente'" -and $comisionesContent -match "userComision")
Assert-Check -testName "api/comisiones aplica scoping estricto: comercial solo recibe su comision" -condition $hasComercialScoping

$noSheetIdLeak = -not ($comisionesContent -match "sheetId:\s*GOOGLE_SHEET_ID" -or $comisionesContent -match "sheetId:\s*sheetId")
Assert-Check -testName "api/comisiones NO expone sheetId en las respuestas JSON" -condition $noSheetIdLeak

$hasStrictAntiCache = ($comisionesContent -match "private, no-cache, no-store, must-revalidate")
Assert-Check -testName "api/comisiones establece cabeceras anti-cache privadas estrictas" -condition $hasStrictAntiCache

# ----------------------------------------------------------------------------
# 5. Scripts de Migracion SQL y RLS
# ----------------------------------------------------------------------------
Write-Host "`n--- 5. SCRIPTS SQL DE MIGRACION Y RLS ---" -ForegroundColor White

$hasReadOnlySql = (Test-Path "migrations/verify_rls_policies_readonly.sql")
Assert-Check -testName "Script SQL de inspeccion de solo lectura creado" -condition $hasReadOnlySql

$hasMigrationSql = (Test-Path "migrations/20261008_security_auth_migration.sql")
Assert-Check -testName "Script SQL de migracion a Supabase Auth y RLS creado" -condition $hasMigrationSql

$migrationContent = if ($hasMigrationSql) { [System.IO.File]::ReadAllText("$PWD\migrations\20261008_security_auth_migration.sql", [System.Text.Encoding]::UTF8) } else { "" }

$hasAgentesPerfiles = ($migrationContent -match "CREATE TABLE IF NOT EXISTS public\.agentes_perfiles")
Assert-Check -testName "Migracion define tabla agentes_perfiles vinculada a auth.users" -condition $hasAgentesPerfiles

$hasConexionesAudit = ($migrationContent -match "CREATE TABLE IF NOT EXISTS public\.conexiones_audit")
Assert-Check -testName "Migracion separa conexiones de la tabla tareas a conexiones_audit" -condition $hasConexionesAudit

$hasSecurityDefinerFns = ($migrationContent -match "current_user_dni" -and $migrationContent -match "is_gerente" -and $migrationContent -match "SECURITY DEFINER")
Assert-Check -testName "Migracion define funciones SECURITY DEFINER con search_path blindado" -condition $hasSecurityDefinerFns

$hasRlsEnabled = ($migrationContent -match "ALTER TABLE public\.agentes_perfiles ENABLE ROW LEVEL SECURITY" -and $migrationContent -match "ALTER TABLE public\.tareas ENABLE ROW LEVEL SECURITY")
Assert-Check -testName "Migracion activa Row Level Security (RLS) en tablas criticas" -condition $hasRlsEnabled

$hasAnonRevoke = ($migrationContent -match "REVOKE ALL ON TABLE public\.agentes_perfiles FROM anon" -and $migrationContent -match "REVOKE ALL ON TABLE public\.tareas FROM anon")
Assert-Check -testName "Migracion revoca todos los privilegios anonimos (anon)" -condition $hasAnonRevoke

$hasTransitionRollback = (Test-Path "migrations/data_transition_and_rollback.sql")
Assert-Check -testName "Script de transicion de datos y reversion segura creado" -condition $hasTransitionRollback

# ----------------------------------------------------------------------------
# 6. Aislamiento de Entorno y Configurabilidad (Sin peticiones a produccion)
# ----------------------------------------------------------------------------
Write-Host "`n--- 6. AISLAMIENTO DE ENTORNO Y CONFIGURABILIDAD ---" -ForegroundColor White

$frontendConfigurable = ($loginContent.IndexOf("window.APP_CONFIG") -ge 0 -and $indexContent.IndexOf("window.APP_CONFIG") -ge 0)
Assert-Check -testName "Frontend configurable por entorno (window.APP_CONFIG implementado)" -condition $frontendConfigurable -details "Evita llamadas fijas a produccion en staging o pruebas"

$backendConfigurable = ($comisionesContent.IndexOf("process.env.SUPABASE_URL") -ge 0 -and $rankingContent.IndexOf("process.env.SUPABASE_URL") -ge 0)
Assert-Check -testName "Backend configurable por variables de entorno (process.env)" -condition $backendConfigurable -details "Permite redirigir llamadas a staging o mocks locales"

$unifiedGoogleVars = ($comisionesContent.IndexOf("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") -ge 0 -and $rankingContent.IndexOf("RANKING_APPS_SCRIPT_URL") -ge 0)
Assert-Check -testName "Variables de entorno de Google unificadas sin claves en codigo" -condition $unifiedGoogleVars

# ----------------------------------------------------------------------------
# Resumen Final
# ----------------------------------------------------------------------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
$color = if ($script:failedCount -eq 0) { "Green" } else { "Red" }
Write-Host " RESUMEN: $($script:passedCount) superadas, $($script:failedCount) fallidas" -ForegroundColor $color
Write-Host "==========================================================" -ForegroundColor Cyan

if ($script:failedCount -gt 0) {
    exit 1
} else {
    exit 0
}
