@echo off
setlocal

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

if not defined JAVA_HOME (
  for /d %%D in ("%USERPROFILE%\.jdks\temurin-21\jdk-21*") do if exist "%%~fD\bin\java.exe" set "JAVA_HOME=%%~fD"
)

if defined JAVA_HOME (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)

if not defined NODE_HOME (
  for /d %%D in ("%USERPROFILE%\.nodes\node-22\node-v22*-win-x64") do if exist "%%~fD\node.exe" set "NODE_HOME=%%~fD"
)

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

echo [emu:full] NPM:
npm.cmd -v
if errorlevel 1 (
  echo [emu:full] ERRO: npm nao encontrado no PATH atual.
  exit /b 1
)

echo [emu:full] Subindo auth, firestore, storage e functions...
npm.cmd run emu:media
set "EMU_EXIT=%ERRORLEVEL%"

if not "%EMU_EXIT%"=="0" (
  echo [emu:full] Emuladores encerraram com codigo %EMU_EXIT%.
  echo [emu:full] Verifique portas ocupadas, Java, Node e logs do Firebase.
)

exit /b %EMU_EXIT%
