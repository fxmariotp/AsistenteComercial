# ═════════════════════════════════════════════════════════════════════
# RENOSUR - Agente Local de Identificación de Dispositivo (Windows)
# ═════════════════════════════════════════════════════════════════════

$Port = 9876
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
    $Listener.Start()
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host "  Renosur Agent Activo en http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "  Hostname Detectado : $env:COMPUTERNAME" -ForegroundColor Yellow
    Write-Host "  Usuario Windows    : $env:USERNAME" -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Cyan
} catch {
    Write-Warning "No se pudo iniciar el listener en 127.0.0.1:$Port ($($_.Exception.Message))"
    Exit
}

function Get-ClientInfoJson {
    $hostname = $env:COMPUTERNAME
    $username = $env:USERNAME
    
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { 
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" 
    } | Select-Object -ExpandProperty IPAddress -First 1)

    if (-not $localIp) {
        try {
            $localIp = [System.Net.Dns]::GetHostAddresses($hostname) | Where-Object { 
                $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike "127.*" 
            } | Select-Object -ExpandProperty IPAddressToString -First 1
        } catch {}
    }

    $osCaption = "Windows"
    try {
        $osCaption = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
    } catch {}

    $data = @{
        ok = $true
        hostname = $hostname
        localIp = if ($localIp) { $localIp } else { "Desconocida" }
        os = $osCaption
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
    } catch {
        # Continuar ante desconexiones
    }
}
