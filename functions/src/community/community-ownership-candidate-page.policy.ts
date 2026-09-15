// functions/src/community/community-ownership-candidate-page.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP CANDIDATE PAGE POLICY
// -----------------------------------------------------------------------------
// Mantém o recorte/cursor da listagem de sucessores independente do Firestore.
// O cursor sempre aponta para o último vínculo efetivamente varrido na página,
// evitando saltos quando a leitura de lookahead encontra uma página adicional.
// -----------------------------------------------------------------------------

export const COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE = 50;

export interface CommunityOwnershipCandidatePageWindow<T> {
  documents: readonly T[];
  nextCursor: string | null;
}

export function resolveCommunityOwnershipCandidatePageWindow<
  T extends Readonly<{ id: string }>,
>(
  documents: readonly T[]
): CommunityOwnershipCandidatePageWindow<T> {
  const pageDocuments = documents.slice(
    0,
    COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE
  );
  const hasNextPage =
    documents.length > COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE;
  const lastDocument = pageDocuments[pageDocuments.length - 1];

  return {
    documents: pageDocuments,
    nextCursor: hasNextPage && lastDocument ? lastDocument.id : null,
  };
}
