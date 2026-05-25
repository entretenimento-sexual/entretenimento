// functions/src/config/functions-region.ts
// -----------------------------------------------------------------------------
// FUNCTIONS REGION
// -----------------------------------------------------------------------------
//
// Região canônica das Cloud Functions que operam com os dados principais da
// plataforma.
//
// Decisão arquitetural:
// - o Firestore principal está provisionado em `nam5`;
// - para recursos em `nam5`, a região de Functions mais próxima indicada pelo
//   Firebase é `us-central1`;
// - centralizar esta configuração evita divergências entre pagamentos,
//   lifecycle, presence, tarefas agendadas e integrações.
//
// Regra:
// - funções novas que interajam com Firestore/Auth/Storage da plataforma devem
//   reutilizar esta constante, salvo decisão técnica explícita em sentido
//   diverso.

export const FUNCTIONS_REGION = 'us-central1' as const;