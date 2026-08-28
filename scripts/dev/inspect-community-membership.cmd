@echo off
setlocal

set "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080"
set "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099"
set "FIREBASE_PROJECT_ID=entretenimento-sexual"

node "%~dp0inspect-community-membership.mjs"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
