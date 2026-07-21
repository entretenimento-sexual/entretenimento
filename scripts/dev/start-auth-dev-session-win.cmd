@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem -----------------------------------------------------------------------------
rem start-auth-dev-session-win.cmd
rem -----------------------------------------------------------------------------
rem Abre ou reutiliza uma sessao local de desenvolvimento Auth no Windows:
rem - inicia uma nova sessao quando todas as portas estao livres;
rem - reutiliza Angular + Firebase quando a sessao existente esta saudavel;
rem - recupera processos orfaos reconhecidos do proprio ambiente;
rem - bloqueia processos desconhecidos para nao encerrar servicos alheios;
rem - preserva o cache Angular por padrao para acelerar retomadas;
rem - inicia Firebase Emulators e Angular em janelas separadas;
rem - registra a saida Angular e exibe diagnostico quando a porta nao abrir;
rem - aguarda os servicos antes de abrir o navegador.
rem
rem Nao exige administrador e nao usa kill-port de forma indiscriminada.
rem -----------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "PROJECT_ROOT=%%~fI"
set "SESSION_REUSED=0"
set "CLEANUP_SCRIPT=%PROJECT_ROOT%\scripts\dev\cleanup-stale-local-session.ps1"
set "ANGULAR_SCRIPT=%PROJECT_ROOT%\scripts\dev\start-angular-emulator-win.ps1"
set "ANGULAR_LOG=%PROJECT_ROOT%\.dev-logs\angular-dev.log"

cd /d "%PROJECT_ROOT%"

echo [dev:auth] Projeto: %CD%
echo [dev:auth] Verificando o estado da sessao local...
node "%PROJECT_ROOT%\scripts\dev\check-local-dev-session.mjs"
set "SESSION_STATE=%ERRORLEVEL%"

if "%SESSION_STATE%"=="10" (
  set "SESSION_REUSED=1"
  goto open_browser
)

if not "%SESSION_STATE%"=="0" (
  if not exist "%CLEANUP_SCRIPT%" (
    echo [dev:auth] ERRO: script seguro de limpeza nao foi encontrado.
    exit /b 1
  )

  echo [dev:auth] Ambiente parcial detectado. Verificando processos residuais reconhecidos...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%CLEANUP_SCRIPT%" -ProjectRoot "%PROJECT_ROOT%"
  set "CLEANUP_STATE=!ERRORLEVEL!"

  if not "!CLEANUP_STATE!"=="0" (
    echo [dev:auth] ERRO: nao foi seguro liberar automaticamente todas as portas.
    echo [dev:auth] Nenhum processo desconhecido foi encerrado.
    exit /b 1
  )

  echo [dev:auth] Revalidando portas apos a recuperacao...
  node "%PROJECT_ROOT%\scripts\dev\check-local-dev-session.mjs"
  set "SESSION_STATE=!ERRORLEVEL!"

  if "!SESSION_STATE!"=="10" (
    set "SESSION_REUSED=1"
    goto open_browser
  )

  if not "!SESSION_STATE!"=="0" (
    echo [dev:auth] ERRO: o ambiente permaneceu inconsistente apos a recuperacao segura.
    exit /b 1
  )
)

if "%ENTRETENIMENTO_FORCE_ANGULAR_CACHE_CLEAN%"=="1" (
  if exist "%PROJECT_ROOT%\.angular\cache" (
    echo [dev:auth] Limpando cache Angular por solicitacao explicita...
    rmdir /s /q "%PROJECT_ROOT%\.angular\cache"
    if exist "%PROJECT_ROOT%\.angular\cache" (
      echo [dev:auth] ERRO: nao foi possivel limpar .angular\cache.
      exit /b 1
    )
  )
) else (
  echo [dev:auth] Preservando cache Angular para acelerar a inicializacao.
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

if not exist "%ANGULAR_SCRIPT%" (
  echo [dev:auth] ERRO: launcher Angular nao foi encontrado: %ANGULAR_SCRIPT%
  exit /b 1
)

if exist "%ANGULAR_LOG%" del /q "%ANGULAR_LOG%" >nul 2>&1

echo [dev:auth] Firebase pronto. Abrindo Angular com log persistente...
start "Entretenimento - Angular" /D "%PROJECT_ROOT%" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%ANGULAR_SCRIPT%" -ProjectRoot "%PROJECT_ROOT%" -HostAddress "127.0.0.1" -Port 4200

echo [dev:auth] Aguardando Angular em 127.0.0.1:4200...
node "%PROJECT_ROOT%\scripts\dev\wait-for-ports.mjs" --ports=4200 --timeout=360000 --label=Angular
if errorlevel 1 (
  echo [dev:auth] ERRO: Angular nao ficou pronto no tempo esperado.
  echo [dev:auth] Log Angular: %ANGULAR_LOG%

  if exist "%ANGULAR_LOG%" (
    echo [dev:auth] Ultimas linhas do Angular:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%ANGULAR_LOG%' -Tail 80"
  ) else (
    echo [dev:auth] O log Angular nao foi criado. Verifique a janela Entretenimento - Angular.
  )

  exit /b 1
)

:open_browser
if "%SESSION_REUSED%"=="1" (
  echo [dev:auth] Sessao existente reconhecida. Nenhum processo duplicado sera iniciado.
) else (
  echo [dev:auth] Nova sessao local iniciada com sucesso.
)

echo [dev:auth] Abrindo navegador...
start "" "http://127.0.0.1:4200/login"
start "" "http://127.0.0.1:4200/register"
start "" "http://127.0.0.1:4000/"

echo [dev:auth] Angular e Firebase estao prontos.
echo [dev:auth] Mantenha as duas janelas abertas enquanto testa.

endlocal
exit /b 0
