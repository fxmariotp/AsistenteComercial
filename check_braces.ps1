$filePath = ".\index.html"
if (-not (Test-Path $filePath)) {
    Write-Error "No se encuentra index.html"
    exit 1
}

$content = [System.IO.File]::ReadAllText((Resolve-Path $filePath), [System.Text.Encoding]::UTF8)

# Contar llaves, corchetes y paréntesis
$openCurly = ($content.ToCharArray() | Where-Object { $_ -eq '{' }).Count
$closeCurly = ($content.ToCharArray() | Where-Object { $_ -eq '}' }).Count

$openSquare = ($content.ToCharArray() | Where-Object { $_ -eq '[' }).Count
$closeSquare = ($content.ToCharArray() | Where-Object { $_ -eq ']' }).Count

$openParen = ($content.ToCharArray() | Where-Object { $_ -eq '(' }).Count
$closeParen = ($content.ToCharArray() | Where-Object { $_ -eq ')' }).Count

Write-Host "--- Verificacion de Sintaxis Basica (Llaves/Corchetes/Parentesis) ---"
Write-Host "Llaves:    { = $openCurly, } = $closeCurly"
Write-Host "Corchetes: [ = $openSquare, ] = $closeSquare"
Write-Host "Parentesis: ( = $openParen, ) = $closeParen"

$errors = 0

if ($openCurly -ne $closeCurly) {
    Write-Warning "Diferencia en llaves { }!"
    $errors++
}
if ($openSquare -ne $closeSquare) {
    Write-Warning "Diferencia en corchetes [ ]!"
    $errors++
}
if ($openParen -ne $closeParen) {
    Write-Warning "Diferencia en parentesis ( )!"
    $errors++
}

if ($errors -eq 0) {
    Write-Host "[OK] Sintaxis balanceada correctamente."
    exit 0
} else {
    Write-Error "[ERROR] Se detectaron discrepancias en los caracteres de agrupacion."
    exit 1
}
