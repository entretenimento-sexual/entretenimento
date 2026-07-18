// src/app/community/data-access/community-membership.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP CLIENT CONTRACTS
// -----------------------------------------------------------------------------

export type CommunityMembershipResultStatus = 'active' | 'pending' | 'left';
export type CommunityMembershipViewerMode = 'member' | 'pending' | 'visitor';
export type CommunityMembershipReviewAction = 'approve' | 'reject';

export interface CommunityMembershipRequestResponse {
  status: CommunityMembershipResultStatus;
  viewerMode: CommunityMembershipViewerMode;
  canInteract: boolean;
}

export interface CommunityMembershipRequestItem {
  memberId: string;
  label: string;
  avatarUrl: string | null;
  requestedAt: number;
}

export interface CommunityMembershipRequestsResponse {
  items: CommunityMembershipRequestItem[];
  generatedAt: number;
}

export interface CommunityMembershipReviewResponse {
  memberId: string;
  status: 'active' | 'left';
  viewerMode: 'member' | 'visitor';
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function normalizeCommunityMembershipResponse(
  raw: unknown
): CommunityMembershipRequestResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const status = source['status'];
  const viewerMode = source['viewerMode'];

  if (status === 'active' && viewerMode === 'member') {
    return {
      status,
      viewerMode,
      canInteract: source['canInteract'] === true,
    };
  }

  if (status === 'pending' && viewerMode === 'pending') {
    return { status, viewerMode, canInteract: false };
  }

  if (status === 'left' && viewerMode === 'visitor') {
    return { status, viewerMode, canInteract: false };
  }

  return null;
}

export function normalizeCommunityMembershipRequestsResponse(
  raw: unknown
): CommunityMembershipRequestsResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeEpoch(source['generatedAt']);

  if (!Array.isArray(source['items']) || !generatedAt) return null;

  const items = source['items']
    .slice(0, 24)
    .map((rawItem): CommunityMembershipRequestItem | null => {
      const item = (rawItem ?? {}) as Record<string, unknown>;
      const memberId = normalizeText(item['memberId'], 128);
      const label = normalizeText(item['label'], 60);
      const requestedAt = normalizeEpoch(item['requestedAt']);

      if (!SAFE_ID_PATTERN.test(memberId) || label.length < 2 || !requestedAt) {
        return null;
      }

      return {
        memberId,
        label,
        avatarUrl: normalizeHttpsUrl(item['avatarUrl']),
        requestedAt,
      };
    })
    .filter((item): item is CommunityMembershipRequestItem => item !== null)
    .sort((left, right) => right.requestedAt - left.requestedAt);

  return { items, generatedAt };
}

export function normalizeCommunityMembershipReviewResponse(
  raw: unknown
): CommunityMembershipReviewResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const memberId = normalizeText(source['memberId'], 128);
  const status = source['status'];
  const viewerMode = source['viewerMode'];

  if (!SAFE_ID_PATTERN.test(memberId)) return null;

  if (status === 'active' && viewerMode === 'member') {
    return { memberId, status, viewerMode };
  }

  if (status === 'left' && viewerMode === 'visitor') {
    return { memberId, status, viewerMode };
  }

  return null;
}
