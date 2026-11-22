# Validação e índice de apelidos

A consulta de disponibilidade passa por `getRegistrationNicknameAvailability`.
A reserva e a conclusão do cadastro validam a titularidade em transação com a
conta privada. O cliente recebe somente o resultado da consulta.

`public_index/nickname-index.service.ts` centraliza a gravação e a remoção no
índice. Suspensão, exclusão, revalidação e reativação usam o mesmo serviço.
`onUserCreateIndexNickname` concilia a partir da conta e da projeção vigentes,
mesmo quando o evento que a acionou chegou atrasado.

O procedimento de preparação e validação dos ambientes está no
[runbook de apelidos](../../docs/operations/registration-nickname-cutover-runbook.md).
