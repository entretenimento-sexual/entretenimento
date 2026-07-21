# Preparação da máquina do trabalho

## Requisitos

A máquina precisa ter:

- Windows 10 ou 11;
- Git for Windows;
- Node.js 22.x instalado globalmente ou disponível como cópia portátil;
- npm junto da instalação do Node 22;
- acesso ao GitHub pelo navegador ou pelo Git Credential Manager;
- permissão para executar processos locais nas portas usadas pelos emuladores.

O projeto declara Node 22 em `.nvmrc` e `.node-version`.

Quando o Windows estiver usando outra versão global, o script procura automaticamente o Node 22 em:

```text
%NODE22_HOME%
%USERPROFILE%\.nodes\node-22
%USERPROFILE%\AppData\Roaming\nvm
```

A seleção vale somente para a sessão iniciada pelo script. O Node global da máquina não é desinstalado nem substituído.

## Primeiro acesso

No PowerShell:

```powershell
Set-Location C:\

git clone https://github.com/entretenimento-sexual/entretenimento.git C:\entretenimento

Set-Location C:\entretenimento

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/dev/setup-work-machine.ps1 `
  -Branch feat/auth-password-recovery-polish `
  -Start
```

O primeiro `git fetch` pode abrir o navegador para autenticação. Isso é esperado. Não coloque token, senha ou PAT na URL do repositório.

## O que o script faz

O `setup-work-machine.ps1`:

1. confirma Git;
2. usa o Node 22 já ativo ou seleciona automaticamente uma instalação portátil compatível;
3. confirma npm na mesma instalação selecionada;
4. verifica se a pasta é o repositório correto;
5. remove credenciais embutidas da URL do `origin`;
6. configura o Git Credential Manager quando disponível;
7. alterna para a branch solicitada;
8. atualiza apenas por fast-forward;
9. instala dependências com `npm ci` quando necessário;
10. inicia Angular e Firebase Emulators quando `-Start` é informado.

O script não grava tokens no projeto, não altera o Node global e não modifica a `main`.

## Retomadas seguintes

Depois da primeira preparação:

```powershell
Set-Location C:\entretenimento

npm.cmd run work:resume:start -- -Branch feat/auth-password-recovery-polish
```

Para atualizar sem iniciar os serviços:

```powershell
npm.cmd run work:resume -- -Branch feat/auth-password-recovery-polish
```

Para uma validação completa antes de enviar alterações:

```powershell
npm.cmd run work:resume:check -- -Branch feat/auth-password-recovery-polish
```

Quando o `node` global não for 22, prefira iniciar pela preparação automática:

```powershell
npm.cmd run work:prepare:win -- -Branch feat/auth-password-recovery-polish -Start
```

## Endereços locais

Com a sessão de emuladores ativa:

- aplicação: `http://127.0.0.1:4200`;
- Firebase Emulator UI: `http://127.0.0.1:4000`;
- Auth Emulator: `127.0.0.1:9099`;
- Firestore Emulator: `127.0.0.1:8080`.

## Restrições corporativas comuns

Proxy, antivírus ou política de execução podem bloquear:

- autenticação no GitHub;
- download de pacotes npm;
- Java exigido pelos testes de Firestore Rules;
- abertura de portas locais;
- execução de scripts PowerShell.

Nesses casos, solicite liberação para GitHub, npm e processos locais do Node/Java. Não contorne políticas de segurança da organização.

## Verificação final

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
node --version
npm.cmd --version
```

A branch deve ser `feat/auth-password-recovery-polish`, o Node selecionado pelo processo deve iniciar com `v22.` e `git status --short` deve permanecer vazio antes de começar a editar.
