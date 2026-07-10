# Ambiente local Windows — emuladores Firebase

Este roteiro padroniza o ambiente local para desenvolvimento no Windows sem exigir administrador.

## Requisitos

- Node 22 disponível no PATH, ou Node portátil em `%USERPROFILE%\.nodes\node-22\node-v22*-win-x64`.
- Java 21 disponível no PATH, ou JDK portátil em `%USERPROFILE%\.jdks\temurin-21\jdk-21*`.
- Dependências instaladas com `npm install`.

## Subir ambiente completo de mídia

Use dois terminais.

### Terminal 1 — Firebase Emulators

```powershell
cd C:\entretenimento
npm.cmd run emu:media:full:win
```

Esse script:

- prioriza JDK 21 portátil quando existir;
- prioriza Node 22 portátil quando existir;
- define `FUNCTIONS_DISCOVERY_TIMEOUT=60` para evitar timeout na descoberta das Cloud Functions;
- sobe `auth`, `firestore`, `storage` e `functions` via `npm run emu:media`.

### Terminal 2 — Angular

```powershell
cd C:\entretenimento
npm.cmd run start:emu
```

## URLs úteis

```text
Aplicação:   http://localhost:4200/
Login:       http://localhost:4200/login
Registro:    http://localhost:4200/register
Emulator UI: http://127.0.0.1:4000/
Auth:        http://127.0.0.1:4000/auth
Firestore:   http://127.0.0.1:4000/firestore
Storage:     http://127.0.0.1:4000/storage
Functions:   http://127.0.0.1:4000/functions
```

## Portas presas

Se o emulador abortar por porta ocupada, primeiro tente encerrar o terminal antigo com `Ctrl + C` para preservar exportação de dados.

Se o processo estiver travado, identifique o PID:

```powershell
netstat -ano | findstr ":8080"
tasklist /FI "PID eq NUMERO_DO_PID"
```

Finalize apenas o processo confirmado:

```powershell
taskkill /PID NUMERO_DO_PID /T /F
```

Use `npm.cmd run emu:pre` apenas quando tiver certeza de que pode matar processos nas portas dos emuladores.

## Validação rápida de Auth

```text
1. /login com senha errada: erro inline no card, sem snackbar duplicado.
2. /login > Esqueci minha senha: modal abre e mostra feedback.
3. /register: sem Google, botão habilita após termos aceitos.
4. Cadastro novo aparece no Auth Emulator.
5. Documento do usuário aparece no Firestore Emulator.
```
