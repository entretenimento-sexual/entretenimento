@echo off
setlocal

rem -----------------------------------------------------------------------------
rem start-auth-dev-session-win.cmd
rem -----------------------------------------------------------------------------
rem Abre uma sessão local de desenvolvimento Auth no Windows:
rem - Terminal 1: Firebase Emulators com Java 21 + Node 22 quando disponíveis.
rem - Terminal 2: Angular em dev-emu.
rem - Navegador: /login, /register e Emulator UI.
rem
rem Não exige administrador. Não mata portas automaticamente.
rem Se houver porta ocupada, o terminal dos emuladores exibirá a orientação segura.
rem -----------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "PROJECT_ROOT=%%~fI"

cd /d "%PROJECT_ROOT%"

echo [dev:auth] Projeto: %CD%
echo [dev:auth] Abrindo emuladores em uma nova janela...
start "Entretenimento - Emuladores" cmd /k "cd /d "%PROJECT_ROOT%" && npm.cmd run emu:media:full:win"

echo [dev:auth] Abrindo Angular em outra janela...
start "Entretenimento - Angular" cmd /k "cd /d "%PROJECT_ROOT%" && npm.cmd run start:emu"

echo [dev:auth] Abrindo navegador...
start "" "http://localhost:4200/login"
start "" "http://localhost:4200/register"
start "" "http://127.0.0.1:4000/"

echo [dev:auth] Sessao iniciada.
echo [dev:auth] Mantenha as duas janelas abertas enquanto testa.

endlocal
