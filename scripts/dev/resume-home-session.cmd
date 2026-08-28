@echo off
setlocal

cd /d "%~dp0\..\.."
if errorlevel 1 (
  echo [work:home] Nao foi possivel acessar a raiz do projeto.
  exit /b 1
)

echo [work:home] Sincronizando, validando e iniciando a sessao local...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\resume-work-session.ps1 -Validate -Start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [work:home] A retomada foi interrompida. Corrija o primeiro erro exibido acima.
  pause
)

exit /b %EXIT_CODE%
