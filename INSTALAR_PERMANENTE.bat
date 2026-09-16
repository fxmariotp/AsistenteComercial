@echo off
title Instalador Permanente - Renosur Agent
echo ========================================================
echo   Instalando Renosur Agent de por vida en este equipo...
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0instalar_agente_permanente.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Reintentando con permisos de PowerShell...
    powershell -Command "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; & '%~dp0instalar_agente_permanente.ps1'"
)
echo.
echo Proceso finalizado. Presiona cualquier tecla para salir.
pause >nul
