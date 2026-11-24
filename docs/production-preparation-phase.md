# Fase de preparação para produção — roteiro preservado

Estado em 24/11/2026: fase adiada até conclusão da auditoria abrangente do módulo Chat e tratamento dos bloqueantes identificados. Não autoriza implantação.

Baseline operacional: `75b90c0e9a03f879f26ce24e585e1b52d1bfb9b9`; 22 testes operacionais aprovados, auditoria estrita de órfãos aprovada, reinicialização Windows com checkpoint e sessão pronta confirmadas pelo operador. QA de mídia documentado em `docs/qa/media-reactivity-manual-validation-20261124.md`.

| Ordem | Frente | Prioridade |
| --- | --- | --- |
| 1 | Implantação da marca institucional | P0 |
| 2 | Identidade visual e canais de contato | P0 |
| 3 | Segurança, privacidade e proteção de menores | P0 |
| 4 | Autenticação e ciclo de vida das contas | P0 |
| 5 | Moderação e controle de exposição das mídias | P0 |
| 6 | Performance, reatividade e custos Firebase | P1 |
| 7 | Tratamento centralizado de erros | P1 |
| 8 | Acessibilidade e responsividade | P1 |
| 9 | Dependências e código residual | P1 |
| 10 | Validação final para implantação | P0 |

## Diretrizes

Exclusivamente `main`, sem novas branches ou PRs, sincronização por fetch explícito e merge --ff-only; preservar nomenclaturas, Observables, acessibilidade, reatividade e tratamento centralizado de erros. Não enfraquecer regras de segurança. Exigir evidência de testes e validação operacional antes de liberar produção. Retomar este roteiro após o Chat; não considerar QA local uma certificação de produção.

## Requisito transversal do Chat (24/11/2026)

Reatividade de ponta a ponta é critério obrigatório de aceite: lista e thread, prévias, mensagens, exclusões, reações, recibos, badges individuais e globais, contadores de não lidas, notificações internas e push (sujeitas a entrega do sistema), mudanças de perfil, bloqueio/desbloqueio, amizade, revogação e restauração de acesso, logout e troca de sessão. Nenhum refresh manual para convergência da UI. Usar autoridade canônica, não contadores paralelos; garantir limpeza de dados antigos, cancelamento de listeners e teste em duas sessões. Validar a recuperação após bloqueios prolongados e o comportamento quando a aplicação está em primeiro/segundo plano. O requisito não implica que notificações push possam ser recolhidas após entrega pelo sistema operacional.
