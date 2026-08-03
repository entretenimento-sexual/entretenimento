import {
  normalizePrivateMediaDraftUsage,
  type PrivateMediaDraftKind,
  type PrivateMediaDraftUsage,
} from './private-media-draft.policy';

export interface PrivateMediaDraftSnapshotInput {
  kind: PrivateMediaDraftKind;
  draftReservationActive?: unknown;
  draftReservedBytes?: unknown;
}

export interface PrivateMediaUploadReservationSnapshotInput {
  kind?: unknown;
  state?: unknown;
  reservedItemCount?: unknown;
  reservedUsageBytes?: unknown;
}

export interface PrivateMediaDraftReconciliationResult {
  current: PrivateMediaDraftUsage;
  expected: PrivateMediaDraftUsage;
  delta: PrivateMediaDraftUsage;
  consistent: boolean;
  activeDrafts: {
    photos: number;
    videos: number;
  };
  activeUploadReservations: number;
}

function nonNegativeInteger(value: unknown): number {
  const normalized = Number(value ?? 0);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(normalized));
}

function emptyUsage(): PrivateMediaDraftUsage {
  return {
    photoCount: 0,
    photoReservedBytes: 0,
    videoCount: 0,
    videoReservedBytes: 0,
  };
}

function addDraft(
  usage: PrivateMediaDraftUsage,
  draft: PrivateMediaDraftSnapshotInput
): void {
  if (draft.draftReservationActive !== true) {
    return;
  }

  const bytes = nonNegativeInteger(draft.draftReservedBytes);

  if (draft.kind === 'photo') {
    usage.photoCount += 1;
    usage.photoReservedBytes += bytes;
    return;
  }

  usage.videoCount += 1;
  usage.videoReservedBytes += bytes;
}

function addActiveUploadReservation(
  usage: PrivateMediaDraftUsage,
  reservation: PrivateMediaUploadReservationSnapshotInput
): boolean {
  if (String(reservation.state ?? '').trim().toUpperCase() !== 'ACTIVE') {
    return false;
  }

  const kind = String(reservation.kind ?? '').trim().toLowerCase();
  const itemCount = nonNegativeInteger(reservation.reservedItemCount);
  const bytes = nonNegativeInteger(reservation.reservedUsageBytes);

  if (kind === 'photo') {
    usage.photoCount += itemCount;
    usage.photoReservedBytes += bytes;
    return true;
  }

  if (kind === 'video') {
    usage.videoCount += itemCount;
    usage.videoReservedBytes += bytes;
    return true;
  }

  return false;
}

export function reconcilePrivateMediaDraftUsage(
  currentValue: unknown,
  drafts: readonly PrivateMediaDraftSnapshotInput[],
  reservations: readonly PrivateMediaUploadReservationSnapshotInput[]
): PrivateMediaDraftReconciliationResult {
  const current = normalizePrivateMediaDraftUsage(currentValue);
  const expected = emptyUsage();
  let activePhotos = 0;
  let activeVideos = 0;

  for (const draft of drafts) {
    addDraft(expected, draft);

    if (draft.draftReservationActive === true) {
      if (draft.kind === 'photo') {
        activePhotos += 1;
      } else {
        activeVideos += 1;
      }
    }
  }

  let activeUploadReservations = 0;

  for (const reservation of reservations) {
    if (addActiveUploadReservation(expected, reservation)) {
      activeUploadReservations += 1;
    }
  }

  const delta: PrivateMediaDraftUsage = {
    photoCount: expected.photoCount - current.photoCount,
    photoReservedBytes:
      expected.photoReservedBytes - current.photoReservedBytes,
    videoCount: expected.videoCount - current.videoCount,
    videoReservedBytes:
      expected.videoReservedBytes - current.videoReservedBytes,
  };
  const consistent = Object.values(delta).every((value) => value === 0);

  return {
    current,
    expected,
    delta,
    consistent,
    activeDrafts: {
      photos: activePhotos,
      videos: activeVideos,
    },
    activeUploadReservations,
  };
}
