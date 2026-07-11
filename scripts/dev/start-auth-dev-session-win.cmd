@echo off
setlocal EnableExtensions

rem -----------------------------------------------------------------------------
rem start-auth-dev-session-win.cmd
rem -----------------------------------------------------------------------------
rem Abre uma sessão local de desenvolvimento Auth no Windows:
rem - Terminal 1: Firebase Emulators com Java 21 + Node 22 quando disponíveis.
rem - aguarda Auth, Firestore e Emulator UI ficarem realmente disponíveis.
rem - Terminal 2: Angular em dev-emu.
rem - aguarda a porta 4200 antes de abrir o navegador.
rem
rem Não exige administrador. Não mata portas automaticamente.
rem -----------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "PROJECT_ROOT=%%~fI"

cd /d "%PROJECT_ROOT%"

echo [dev:auth] Projeto: %CD%
echo [dev:auth] Abrindo emuladores em uma nova janela...
start "Entretenimento - Emuladores" /D "%PROJECT_ROOT%" cmd /k "npm.cmd run emu:media:full:win"

echo [dev:auth] Aguardando Auth 9099, Firestore 8080 e UI 4000...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=9099,8080,4000 --timeout=180000 --label=Firebase
if errorlevel 1 (
  echo [dev:auth] ERRO: Firebase nao ficou pronto no tempo esperado.
  echo [dev:auth] Verifique a janela Entretenimento - Emuladores.
  exit /b 1
)

echo [dev:auth] Firebase pronto. Abrindo Angular em outra janela...
start "Entretenimento - Angular" /D "%PROJECT_ROOT%" cmd /k "npm.cmd run start:emu"

echo [dev:auth] Aguardando Angular na porta 4200...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=4200 --timeout=120000 --label=Angular
if errorlevel 1 (
  echo [dev:auth] ERRO: Angular nao ficou pronto no tempo esperado.
  echo [dev:auth] Verifique a janela Entretenimento - Angular.
  exit /b 1
)

echo [dev:auth] Abrindo navegador...
start "" "http://localhost:4200/login"
start "" "http://localhost:4200/register"
start "" "http://127.0.0.1:4000/"

echo [dev:auth] Sessao iniciada com Firebase e Angular prontos.
echo [dev:auth] Mantenha as duas janelas abertas enquanto testa.

endlocal
