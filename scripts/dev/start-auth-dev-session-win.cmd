@echo off
setlocal EnableExtensions

rem -----------------------------------------------------------------------------
rem start-auth-dev-session-win.cmd
rem -----------------------------------------------------------------------------
rem Abre uma sessão local de desenvolvimento Auth no Windows:
rem - verifica se as portas necessárias estão livres, evitando reutilizar processos antigos;
rem - limpa o cache de build do Angular antes de iniciar a nova sessão;
rem - Terminal 1: Firebase Emulators com Java 21 + Node 22 quando disponíveis;
rem - aguarda Auth, Firestore e Emulator UI ficarem realmente disponíveis;
rem - Terminal 2: Angular em dev-emu, fixado em IPv4 127.0.0.1:4200;
rem - aguarda a porta 4200 antes de abrir o navegador.
rem
rem Não exige administrador e não encerra processos automaticamente.
rem -----------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "PROJECT_ROOT=%%~fI"

cd /d "%PROJECT_ROOT%"

echo [dev:auth] Projeto: %CD%
echo [dev:auth] Verificando se não há sessão antiga nas portas locais...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=4000,4200,4400,4500,5001,8080,9099,9199 --state=free --timeout=1500 --label=portas-locais
if errorlevel 1 (
  echo [dev:auth] ERRO: existe uma sessão local antiga ou outro processo usando as portas necessárias.
  echo [dev:auth] Feche as janelas antigas de Angular/Firebase e execute novamente.
  echo [dev:auth] Para encerrar manualmente: npx kill-port 4000 4200 4400 4500 5001 8080 9099 9199
  exit /b 1
)

if exist "%PROJECT_ROOT%\.angular\cache" (
  echo [dev:auth] Limpando cache Angular para evitar bundles antigos...
  rmdir /s /q "%PROJECT_ROOT%\.angular\cache"
  if exist "%PROJECT_ROOT%\.angular\cache" (
    echo [dev:auth] ERRO: nao foi possivel limpar .angular\cache.
    echo [dev:auth] Feche processos Node/Angular ainda ativos e tente novamente.
    exit /b 1
  )
)

echo [dev:auth] Abrindo emuladores em uma nova janela...
start "Entretenimento - Emuladores" /D "%PROJECT_ROOT%" cmd /k "call npm.cmd run emu:media:full:win"

echo [dev:auth] Aguardando Auth 9099, Firestore 8080 e UI 4000...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=9099,8080,4000 --timeout=180000 --label=Firebase
if errorlevel 1 (
  echo [dev:auth] ERRO: Firebase nao ficou pronto no tempo esperado.
  echo [dev:auth] Verifique a janela Entretenimento - Emuladores.
  exit /b 1
)

echo [dev:auth] Firebase pronto. Abrindo Angular em outra janela...
start "Entretenimento - Angular" /D "%PROJECT_ROOT%" cmd /k "call npm.cmd run start:emu -- --host 127.0.0.1 --port 4200"

echo [dev:auth] Aguardando Angular em 127.0.0.1:4200...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=4200 --timeout=180000 --label=Angular
if errorlevel 1 (
  echo [dev:auth] ERRO: Angular nao ficou pronto no tempo esperado.
  echo [dev:auth] Verifique a janela Entretenimento - Angular.
  echo [dev:auth] Teste manual: npm.cmd run start:emu -- --host 127.0.0.1 --port 4200
  exit /b 1
)

echo [dev:auth] Abrindo navegador...
start "" "http://127.0.0.1:4200/login"
start "" "http://127.0.0.1:4200/register"
start "" "http://127.0.0.1:4000/"

echo [dev:auth] Sessao iniciada com Firebase e Angular prontos.
echo [dev:auth] Mantenha as duas janelas abertas enquanto testa.

endlocal
