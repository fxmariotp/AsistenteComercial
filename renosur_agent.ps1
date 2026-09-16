# ═════════════════════════════════════════════════════════════════════
# RENOSUR - Agente Local de Identificación de Dispositivo (Windows)
# ═════════════════════════════════════════════════════════════════════
# Este script escucha únicamente en 127.0.0.1:9876 y permite a la aplicación
# web Asistente Comercial identificar de forma segura el Hostname y la IP local.
#
# Para ejecutar en segundo plano al iniciar Windows:
# powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File .\renosur_agent.ps1
# ═════════════════════════════════════════════════════════════════════

$Port = 9876
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
$Listener.Prefixes.Add("http://localhost:$Port/")

try {
    $Listener.Start()
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host "  Renosur Agent Activo en http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "  Hostname Detectado : $env:COMPUTERNAME" -ForegroundColor Yellow
    Write-Host "  Usuario Windows    : $env:USERNAME" -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host "Presiona Ctrl+C para detener."
} catch {
    Write-Warning "No se pudo iniciar el listener en el puerto $Port. ¿Ya se esta ejecutando otra instancia?"
    Exit
}

function Get-ClientInfoJson {
    $hostname = $env:COMPUTERNAME
    $username = $env:USERNAME
    
    # Obtener la IP local IPv4 preferente (excluyendo loopback y 169.254)
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

        # Cabeceras CORS para permitir la lectura desde https://asistente-comercial.vercel.app
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
    } catch {
        # Continuar escuchando ante desconexiones de cliente
    }
}
