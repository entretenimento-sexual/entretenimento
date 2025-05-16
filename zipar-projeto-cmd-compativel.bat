@echo off
title Zipador Angular Firebase - Compatível CMD
setlocal EnableDelayedExpansion

echo.
echo ===============================================
echo         Zipador de Projeto Angular         
echo ===============================================
echo.
echo Escolha uma opcao:
echo.
echo 1. Compactar apenas a pasta src/ (src.zip)
echo 2. Compactar projeto completo (projeto-angular-firebase.zip)
echo.

set /p opcao=Digite o numero da opcao desejada e pressione Enter: 

IF "%opcao%"=="1" (
    echo.
    echo Compactando apenas a pasta src...
    powershell -Command "Compress-Archive -Path '.\src\*' -DestinationPath 'C:\Users\salau\Desktop\src.zip' -Force"
    echo src.zip criado na sua Area de Trabalho.
    set "arquivo=C:\Users\salau\Desktop\src.zip"
) ELSE IF "%opcao%"=="2" (
    echo.
    echo Compactando projeto completo...
    powershell -Command "Compress-Archive -Path '.\src\*','.\angular.json','.\package.json','.\tsconfig.json','.\firebase.json','.\.firebaserc','.\README.md' -DestinationPath 'C:\Users\salau\Desktop\projeto-angular-firebase.zip' -Force"
    echo projeto-angular-firebase.zip criado na sua Area de Trabalho.
    set "arquivo=C:\Users\salau\Desktop\projeto-angular-firebase.zip"
) ELSE (
    echo Opcao invalida. Encerrando...
    pause
    exit /b
)

for %%I in ("!arquivo!") do set tamanho=%%~zI
set /a tamanhoMB=!tamanho!/1024/1024

echo.
echo Tamanho do arquivo gerado: !tamanhoMB! MB
echo.

echo Abrindo Google Drive para upload...
start https://drive.google.com/drive/my-drive

echo.
echo Pronto! Agora envie o zip e cole o link aqui para analise. 
pause
