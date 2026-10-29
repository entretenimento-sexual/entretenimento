# Instruções obrigatórias para agentes — Entretenimento

## REGRA OBRIGATÓRIA: SOMENTE MAIN — SEM BRANCH, MERGE OU PR

**Ordem expressa do proprietário do repositório. Aplica-se a agentes de IA, automações e colaboradores.**

1. **NÃO criar branches novas**, locais ou remotas, nem worktrees de desenvolvimento, mesmo para correções pequenas, experimentos, testes ou organização.
2. **NÃO criar, abrir, atualizar ou empilhar Pull Requests (PRs)** para novas implementações. PRs antigos não autorizam continuar trabalhando em branches deles.
3. **NÃO executar merges** (nem `git merge`, merge de PRs, merge commits, `git rebase` ou `git cherry-pick` para integrar trabalho). Não usar estratégias equivalentes para contornar esta proibição.
4. **Trabalhar exclusivamente na branch `main` existente**, com alterações pequenas, delimitadas, testes e commits diretos. Antes de gravar, confirmar o HEAD remoto; nunca forçar push nem sobrescrever alterações concorrentes.
5. **Se houver qualquer bloqueio para editar a `main` com segurança, interromper a operação e informar o impedimento.** Nunca criar branch ou PR como alternativa automática.
6. **Sem deploy, migração/destruição de dados, alterações no Firebase real ou remoção de arquivos de testes** sem autorização explícita e separada. Preservar arquivos locais não rastreados (incluindo galerias e backups); não executar `git clean` ou `git reset --hard`.
7. **A regra só muda com uma nova ordem explícita do proprietário**, para a operação específica. Uma prática de Git recomendada, convenção de ferramenta ou sugestão do assistente não substitui essa ordem.

Fluxo: `git branch --show-current` deve retornar `main`; conferir `git status --short`; usar `git pull --ff-only origin main` quando seguro; editar apenas o escopo combinado; testar; realizar commit direto na `main` e verificar o CI. **Não criar branch, não fazer merge e não criar PR.**

Estas instruções têm prioridade operacional sobre orientações históricas de branches ou PRs em outros documentos do repositório. Se houver conflito entre arquivos Markdown, prevalece esta política atual de trabalho na `main`.
