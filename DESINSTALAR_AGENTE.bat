@echo off
title Desinstalar Renosur Agent
echo ========================================================
echo   Desinstalando Renosur Agent de este equipo...
echo ========================================================
powershell -ExecutionPolicy Bypass -Command "Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*RenosurAgent*' } | Stop-Process -Force -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'RenosurClientAgent' -Confirm:$false -ErrorAction SilentlyContinue; Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'RenosurAgent' -ErrorAction SilentlyContinue; Remove-Item -Path \"$env:LOCALAPPDATA\RenosurAgent\" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Agente desinstalado correctamente.' -ForegroundColor Green"
echo.
echo Proceso finalizado.
pause
