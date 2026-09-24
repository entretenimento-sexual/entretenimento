# Assinatura → ownership → capacidade de Comunidades

## Regra canônica

Comunidades pessoais derivam criação, quantidade de Comunidades próprias e capacidade do entitlement atual do proprietário. Downgrade ou perda de entitlement nunca remove membros existentes e nunca transfere a propriedade automaticamente.

Quando assinatura, quota de ownership ou capacidade configurada deixam de ser compatíveis, a Comunidade recebe `capacityRegularization` com versão de política, motivos, estado, início, prazo, entitlement efetivo e ações disponíveis.

A janela inicial é de 30 dias e vive em `COMMUNITY_PRODUCT_LIMITS.capacityRegularization.gracePeriodDays`. O prazo é governança de regularização, não calibração de capacidade Business/Official nem mudança de score.

## Estados

- `grace_period`: o owner e admins são avisados. A capacidade continua respeitando imediatamente o teto do entitlement atual; membros existentes permanecem.
- `action_required`: ao vencer o prazo sem regularização, novas entradas ficam pausadas. Membros e conteúdo existentes são preservados.
- resolvido: o campo canônico é limpo e a notificação deixa de exigir ação.

Ações admitidas: regularizar o plano, transferir ownership ou arquivar. Não existe sucessão automática por downgrade.

## Transferência

A transferência continua exigindo membership e conta elegíveis e passa a revalidar, de forma autoritativa na transação:

1. entitlement que permita possuir Comunidades pessoais;
2. quota disponível de Comunidades próprias;
3. capacidade do plano suficiente para a capacidade configurada da Comunidade.

A aquisição/liberação de ownership participa do mesmo revision lock usado pela criação para impedir corrida entre create/transfer.

## Reconciliação

Mudanças no entitlement ou nos campos relevantes da Comunidade disparam reconciliação. Uma rotina diária paginada também cobre expiração temporal do entitlement e avanço de prazos mesmo sem webhook no instante exato.

O estado materializado é derivado. A fonte financeira continua sendo `entitlements/platform_subscription_{uid}`; ownership continua em `communities.ownerUid`.

## Quotas pessoais atuais

As quotas canônicas permanecem, nesta mudança:

- Free: 0
- Basic: 1
- Premium: 3
- VIP: 5
- Admin: sem limite comercial pessoal

Esses números não foram reduzidos nesta alteração. O repositório está em `OBSERVE_ONLY`; esta PR fecha a governança do downgrade sem misturar uma recalibração comercial sem evidência. Uma redução inicial das quotas deve ser uma decisão separada e explícita no ponto canônico `COMMUNITY_PRODUCT_LIMITS.ownedPersonalCommunitiesBySponsorRole`.
