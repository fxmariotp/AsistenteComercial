@echo off
title Renosur Agente Local
echo ========================================================
echo   Iniciando Renosur Agente de Identificacion Local...
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0renosur_agent.ps1"
pause
