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
  for /d %%D in ("%USERPROFILE%\.jdks\temurin-21\jdk-21*") do set "JAVA_HOME=%%~fD"
)

if defined JAVA_HOME (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
)

if not defined NODE_HOME (
  for /d %%D in ("%USERPROFILE%\.nodes\node-22\node-v22*-win-x64") do set "NODE_HOME=%%~fD"
)

if defined NODE_HOME (
  set "PATH=%NODE_HOME%;%PATH%"
)

set "FUNCTIONS_DISCOVERY_TIMEOUT=60"

cd /d "%PROJECT_ROOT%"

echo [emu:full] Projeto: %CD%
echo [emu:full] Java:
java -version
echo [emu:full] Node:
node -v

echo [emu:full] Subindo auth, firestore, storage e functions...
npm.cmd run emu:media

endlocal
