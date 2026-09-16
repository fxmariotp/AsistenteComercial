# ═════════════════════════════════════════════════════════════════════
# RENOSUR - Instalador Permanente del Agente de Identificación
# ═════════════════════════════════════════════════════════════════════

$TargetDir = "$env:LOCALAPPDATA\RenosurAgent"
$ScriptTarget = "$TargetDir\renosur_agent.ps1"
$TaskName = "RenosurClientAgent"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Instalando Renosur Agent de forma permanente..." -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Crear carpeta permanente en AppData
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

# 2. Copiar renosur_agent.ps1
$SourceScript = Join-Path $PSScriptRoot "renosur_agent.ps1"
if (Test-Path $SourceScript) {
    Copy-Item -Path $SourceScript -Destination $ScriptTarget -Force
} else {
    # Si se ejecuta desde web o no encuentra el archivo local, crearlo directamente
    $AgentCode = @'
$Port = 9876
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
$Listener.Prefixes.Add("http://localhost:$Port/")
try {
    $Listener.Start()
} catch {
    Exit
}
function Get-ClientInfoJson {
    $hostname = $env:COMPUTERNAME
    $username = $env:USERNAME
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" 
    } | Select-Object -ExpandProperty IPAddress -First 1)
    if (-not $localIp) {
        $localIp = [System.Net.Dns]::GetHostAddresses($hostname) | Where-Object { 
            $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike "127.*" 
        } | Select-Object -ExpandProperty IPAddressToString -First 1
    }
    $osName = (Get-CimInstance Win32_OperatingSystem).Caption
    $data = @{
        ok = $true
        hostname = $hostname
        localIp = if ($localIp) { $localIp } else { "Desconocida" }
        os = $osName
        user = $username
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    return ($data | ConvertTo-Json -Compress)
}
while ($Listener.IsListening) {
    try {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response
        $Response.AddHeader("Access-Control-Allow-Origin", "*")
        $Response.AddHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
        $Response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
        $Response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
        if ($Request.HttpMethod -eq "OPTIONS") {
            $Response.StatusCode = 204
            $Response.Close()
            continue
        }
        $Json = Get-ClientInfoJson
        $Buffer = [System.Text.Encoding]::UTF8.GetBytes($Json)
        $Response.ContentType = "application/json; charset=utf-8"
        $Response.ContentLength64 = $Buffer.Length
        $Response.OutputStream.Write($Buffer, 0, $Buffer.Length)
        $Response.Close()
    } catch {}
}
'@
    Set-Content -Path $ScriptTarget -Value $AgentCode -Encoding UTF8
}

# 3. Detener procesos previos si existen
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*RenosurAgent*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# 4. Registrar en el inicio automático de Windows (Registro HKCU Run)
$RegKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$CmdValue = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptTarget`""
Set-ItemProperty -Path $RegKey -Name "RenosurAgent" -Value $CmdValue -Force

# 5. Registrar también como Tarea Programada de Windows (SchTasks) para máxima robustez
try {
    $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptTarget`""
    $Trigger = New-ScheduledTaskTrigger -AtLogOn
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Renosur Device Identification Agent" -Force -ErrorAction SilentlyContinue | Out-Null
} catch {}

# 6. Iniciar el agente ahora mismo en segundo plano invisible
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptTarget`""

Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "  [OK] INSTALACION COMPLETADA CON EXITO" -ForegroundColor Green
Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "  * Hostname registrado : $env:COMPUTERNAME" -ForegroundColor Cyan
Write-Host "  * Estado actual       : En ejecucion en segundo plano" -ForegroundColor Cyan
Write-Host "  * Inicio automatico   : Activado de por vida al encender el PC" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Ya puedes cerrar esta ventana."
Start-Sleep -Seconds 3
