// functions/src/community/community-discovery-cursor.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY CURSOR POLICY
// -----------------------------------------------------------------------------
// O cursor é opaco para o cliente e carrega o modo de ranking que originou a
// página. Isso impede reutilizar um cursor de `rankScore` depois de um cutover
// para `discoveryScore` (ou vice-versa), evitando saltos/duplicações entre páginas.
// Cursors antigos sem envelope continuam aceitos somente no modo legado.
// -----------------------------------------------------------------------------

import type {
  CommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';

const CURSOR_ENVELOPE_VERSION = 'cursor1';
const CURSOR_ENVELOPE_PATTERN = /^cursor\d+:/;
const SAFE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SCORE_MODE_PATTERN = /^score_v[1-9]\d*$/;

export interface CommunityDiscoveryCursor {
  mode: CommunityDiscoveryRankingMode;
  documentId: string;
  legacyTransport: boolean;
}

function normalizeMode(value: unknown): CommunityDiscoveryRankingMode | null {
  const normalized = String(value ?? '').trim();
  if (normalized === 'legacy') return 'legacy';
  return SCORE_MODE_PATTERN.test(normalized)
    ? normalized as CommunityDiscoveryRankingMode
    : null;
}

function normalizeDocumentId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_DOCUMENT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function buildCommunityDiscoveryCursor(
  mode: CommunityDiscoveryRankingMode,
  documentIdRaw: unknown
): string | null {
  const documentId = normalizeDocumentId(documentIdRaw);
  if (!documentId) return null;

  return `${CURSOR_ENVELOPE_VERSION}:${mode}:${documentId}`;
}

export function parseCommunityDiscoveryCursor(
  raw: unknown
): CommunityDiscoveryCursor | null {
  const normalized = String(raw ?? '').trim();
  if (!normalized) return null;

  if (!normalized.startsWith(`${CURSOR_ENVELOPE_VERSION}:`)) {
    if (CURSOR_ENVELOPE_PATTERN.test(normalized)) return null;

    const documentId = normalizeDocumentId(normalized);
    return documentId
      ? { mode: 'legacy', documentId, legacyTransport: true }
      : null;
  }

  const parts = normalized.split(':');
  if (parts.length < 3 || parts[0] !== CURSOR_ENVELOPE_VERSION) return null;

  const mode = normalizeMode(parts[1]);
  const documentId = normalizeDocumentId(parts.slice(2).join(':'));
  if (!mode || !documentId) return null;

  return {
    mode,
    documentId,
    legacyTransport: false,
  };
}
