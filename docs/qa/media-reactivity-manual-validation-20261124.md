# Validação funcional de reatividade de mídias — 24/11/2026

## Ambiente e evidência

- Commit validado: `ffb14a8254262641d2a3e20aeca082b527a53c47`.
- Ambiente local Angular dev-emu e Firebase Emulator Suite, diagnóstico `AMBIENTE_PRONTO_PARA_QA`.
- Duas sessões independentes: proprietário e visitante. Resultados informados pelo operador durante a validação manual; não constituem execução automatizada ou certificação de produção.

## Cenários

| Cenário | Resultado informado |
| --- | --- |
| Exclusão de foto com galeria aberta | Aprovado |
| Exclusão de foto aberta no visualizador | Aprovado |
| Exclusão de vídeo com galeria aberta | Aprovado |
| Exclusão de vídeo durante reprodução | Aprovado |
| Solicitação e cancelamento de exclusão da conta | Aprovado |
| Bloqueio, desbloqueio e exclusão de vídeo após desbloqueio | Aprovado (confirmação conjunta do roteiro) |

A exclusão individual após cancelamento da exclusão da conta não recebeu confirmação isolada; manter cobertura automatizada e verificar esse cenário em regressão futura. Não inferir validação de todos os caminhos de autorização ou segurança a partir destes testes.

## Pendências operacionais observadas

- `emu:stop:win`: checkpoint concluído, mas `taskkill` retornou erro para filhos já inexistentes; a sessão foi recuperada pelo launcher canônico. Confirmar pós-condições de encerramento em vez de aceitar ou rejeitar apenas pelo código de retorno.
- Diagnóstico de sessão: uma sondagem de callable retornou status 0 após inicialização; nova verificação confirmou prontidão. Avaliar retry limitado para falhas transitórias sem relaxar CORS, identidade ou HEAD.
- Manter mudanças operacionais separadas da lógica de mídia; executar testes de regressão e verificar CI antes da preparação de produção.
