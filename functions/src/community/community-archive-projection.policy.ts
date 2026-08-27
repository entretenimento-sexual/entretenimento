// functions/src/community/community-archive-projection.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY ARCHIVE PROJECTION POLICY
// -----------------------------------------------------------------------------
// Detecta somente a transição canônica para archived. A limpeza decorrente é
// idempotente e remove projeções de navegação, nunca memberships ou conteúdo.
// -----------------------------------------------------------------------------

export function shouldCleanupCommunityArchiveProjections(
  rawBefore: unknown,
  rawAfter: unknown
): boolean {
  const before = (rawBefore ?? {}) as Record<string, unknown>;
  const after = (rawAfter ?? {}) as Record<string, unknown>;
  const source = (after['source'] ?? {}) as Record<string, unknown>;

  return source['type'] === 'community'
    && after['status'] === 'archived'
    && before['status'] !== 'archived';
}
