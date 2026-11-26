# CHAT-R1.10.3.4.1b — Compartilhamento de snapshots por geração

Base: 4e249869. Quality Gate 45749387536 e certificação Chromium 45749387597 concluídos com sucesso.

Esta intervenção limita o compartilhamento ao transporte de documentos entre a descoberta legada e a conversa individual, após cada consumidor confirmar separadamente o candidato no backend. O inbox paginado mantém seu listener independente até uma etapa própria. O sinal de revisão não concede acesso.

O registro é indexado pela identidade da emissão confirmada da revisão (não pelo número) e pelo ID do chat. Revogação, perda da confirmação, mudança de conta e nova geração invalidam a associação anterior. Um consumidor atrasado não pode reativar uma geração antiga. A última desinscrição encerra o transporte e elimina o replay; falhas e conclusão também reiniciam o compartilhamento. O transporte continua sujeito às Firestore Rules e preserva a recuperação existente. Revisões numericamente idênticas na mesma sessão são deduplicadas.

Testes unitários adicionados para compartilhamento, isolamento de IDs, troca de geração com número idêntico, revogação, confirmação nula, erro e teardown. A certificação do novo commit depende da CI. Nenhuma alteração de Rules, Functions, mensagens, recibos, produção ou permissões.
