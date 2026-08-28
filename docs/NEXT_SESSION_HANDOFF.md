# Next Session Handoff

## Projeto atual

- Repositório: `entretenimento-sexual/entretenimento`
- Pasta local usual: `C:\entretenimento`
- Branch de trabalho atual: `feat/auth-password-recovery-polish`
- Firebase local: emuladores de Auth, Firestore, Storage, Functions e serviços auxiliares
- Node.js: 22.x, declarado em `.nvmrc` e `.node-version`

## Retomar uma máquina já preparada

```powershell
Set-Location C:\entretenimento

npm.cmd run work:resume:start -- -Branch feat/auth-password-recovery-polish
```

O comando:

1. interrompe a atualização quando existem alterações locais;
2. busca a branch remota;
3. atualiza somente por fast-forward;
4. instala dependências somente quando o lock mudou;
5. inicia Angular e Firebase Emulators.

## Preparar uma nova máquina Windows

Consulte `docs/WORK_MACHINE_SETUP.md`.

Fluxo resumido:

```powershell
Set-Location C:\

git clone https://github.com/entretenimento-sexual/entretenimento.git C:\entretenimento

Set-Location C:\entretenimento

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/dev/setup-work-machine.ps1 `
  -Branch feat/auth-password-recovery-polish `
  -Start
```

Nunca coloque PAT, token ou senha na URL do `origin`.

## Validação

Antes de considerar um bloco concluído:

```powershell
npm.cmd run audit:visual:strict
npm.cmd run test:ci
npm.cmd run build:safe
npm.cmd --prefix functions run test
npm.cmd --prefix functions run lint:deploy:all
```

O Quality Gate remoto continua sendo a evidência final.

## Contrato visual

A auditoria de densidade visual está documentada em `docs/VISUAL_DENSITY_AUDIT.md`.

Nas telas críticas:

- um único `h1`;
- título curto;
- ações próximas ao título;
- sem combinação decorativa de eyebrow, título e subtítulo;
- estados vazios e erros continuam orientando o usuário;
- textos legais, financeiros e de segurança são preservados quando necessários.

## Segurança operacional

- não trabalhar diretamente na `main`;
- não executar deploy durante revisão local;
- não alterar Rules, índices, Functions ou ambientes sem escopo explícito;
- não usar Firebase real para testes de desenvolvimento quando existe emulador correspondente;
- não usar `git reset --hard` ou `git clean` para resolver divergência;
- não sobrescrever alterações locais detectadas pelo script de retomada.

## Endereços locais

- aplicação: `http://127.0.0.1:4200`;
- Emulator UI: `http://127.0.0.1:4000`;
- Auth: `127.0.0.1:9099`;
- Firestore: `127.0.0.1:8080`.

## Estado de trabalho

O projeto está na fase de limpeza transversal de interface, acessibilidade, feedback de rede, retenção de conta e operação administrativa. O trabalho deve continuar em blocos pequenos, validados e sem merge/deploy automático.
