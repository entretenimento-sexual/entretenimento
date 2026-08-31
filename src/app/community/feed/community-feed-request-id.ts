// src/app/community/feed/community-feed-request-id.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REQUEST ID
// -----------------------------------------------------------------------------
// Idempotência client-side compartilhada pelas mutações do Mural. Mantém o
// formato histórico "mural-*" para não criar dois contratos de requestId.
// -----------------------------------------------------------------------------

export function createCommunityFeedRequestId(): string {
  try {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) return randomUuid;
  } catch {
    // O fallback continua fornecendo um identificador estável para a tentativa.
  }

  return `mural-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}
