@echo off
setlocal EnableExtensions

rem -----------------------------------------------------------------------------
rem start-emu-media-full.cmd
rem -----------------------------------------------------------------------------
rem Sobe o ambiente local de mídia no Windows priorizando JDK 21 e Node 22
rem portáteis no usuário, quando existirem.
rem
rem Este script não exige administrador. Ele apenas ajusta PATH/JAVA_HOME/NODE_HOME
rem para esta execução e aumenta o timeout de descoberta das Cloud Functions.
rem -----------------------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "PROJECT_ROOT=%%~fI"

rem Prioriza explicitamente o JDK 21 portátil do usuário quando disponível.
set "PORTABLE_JAVA_HOME="
for /d %%D in ("%USERPROFILE%\.jdks\temurin-21\jdk-21*") do if exist "%%~fD\bin\java.exe" set "PORTABLE_JAVA_HOME=%%~fD"
if defined PORTABLE_JAVA_HOME set "JAVA_HOME=%PORTABLE_JAVA_HOME%"

if defined JAVA_HOME (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)

rem Prioriza explicitamente o Node 22 portátil porque functions/package.json usa engine 22.
set "PORTABLE_NODE_HOME="
for /d %%D in ("%USERPROFILE%\.nodes\node-22\node-v22*-win-x64") do if exist "%%~fD\node.exe" set "PORTABLE_NODE_HOME=%%~fD"
if defined PORTABLE_NODE_HOME set "NODE_HOME=%PORTABLE_NODE_HOME%"

if defined NODE_HOME (
  set "PATH=%NODE_HOME%;%PATH%"
)

set "FUNCTIONS_DISCOVERY_TIMEOUT=60"

cd /d "%PROJECT_ROOT%"

echo [emu:full] Projeto: %CD%
echo [emu:full] Java:
java -version
if errorlevel 1 (
  echo [emu:full] ERRO: Java nao encontrado. Instale ou aponte um JDK 21.
  exit /b 1
)

echo [emu:full] Node:
node -v
if errorlevel 1 (
  echo [emu:full] ERRO: Node nao encontrado. Instale ou aponte Node 22.
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not "%NODE_MAJOR%"=="22" (
  echo [emu:full] AVISO: Functions declara Node 22, mas o ambiente atual usa Node %NODE_MAJOR%.
  echo [emu:full] O script continua, mas prefira Node 22 para reproduzir o runtime oficial.
)

echo [emu:full] NPM:
call npm.cmd -v
if errorlevel 1 (
  echo [emu:full] ERRO: npm nao encontrado no PATH atual.
  exit /b 1
)

echo [emu:full] Subindo auth, firestore, storage e functions...
call npm.cmd run emu:media
set "EMU_EXIT=%ERRORLEVEL%"

if not "%EMU_EXIT%"=="0" (
  echo [emu:full] Emuladores encerraram com codigo %EMU_EXIT%.
  echo [emu:full] Verifique portas ocupadas, Java, Node e logs do Firebase.
)

exit /b %EMU_EXIT%
