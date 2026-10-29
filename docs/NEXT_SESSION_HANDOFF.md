# Next Session Handoff

> **REGRA ATUAL — VER `AGENTS.md`: somente `main`; proibido criar branches, fazer merges ou criar PRs.** Instruções antigas de retomada de branches não estão vigentes.

## Projeto atual

- Repositório: `entretenimento-sexual/entretenimento`
- Pasta local usual: `C:\entretenimento`
- Linha única de desenvolvimento: `main` (não criar outras branches, PRs ou merges)
- Firebase local: emuladores de Auth, Firestore, Storage, Functions e serviços auxiliares
- Node.js: 22.x, declarado em `.nvmrc` e `.node-version`

## Retomar uma máquina já preparada

```powershell
Set-Location C:\entretenimento

git branch --show-current
# Deve mostrar main. Conferir antes os arquivos locais existentes.
git status --short
git pull --ff-only origin main
npm.cmd run start:emu
```

Os comandos acima não criam branches nem PRs. **Se existirem alterações rastreadas conflitantes, não fazer o `pull` até inspecioná-las.** Arquivos não rastreados de teste (galerias, JSON e ZIP) devem ser preservados. Os emuladores precisam estar ativos para a configuração `dev-emu`.

## Preparar uma nova máquina Windows

Consulte `docs/WORK_MACHINE_SETUP.md`.

Fluxo resumido:

```powershell
Set-Location C:\

git clone https://github.com/entretenimento-sexual/entretenimento.git C:\entretenimento

Set-Location C:\entretenimento

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/dev/setup-work-machine.ps1 `
  -Branch main `
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

- trabalhar somente na `main`, sem criar branches, PRs ou executar merges;
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

O projeto está na fase de limpeza transversal de interface, acessibilidade, feedback de rede, retenção de conta e operação administrativa. O trabalho deve continuar em blocos pequenos, validados e sem merges, PRs ou deploy automático.
