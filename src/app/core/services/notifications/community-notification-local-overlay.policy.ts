export interface CommunityNotificationLocalOverlayItem {
  readonly communityId: string;
}

export interface CommunityNotificationLocalOverlayState<
  T extends CommunityNotificationLocalOverlayItem
> {
  readonly viewerUid: string | null;
  readonly serverSummaries: readonly T[];
  readonly suppressedCommunityIds: readonly string[];
}

export type CommunityNotificationLocalOverlayEvent<
  T extends CommunityNotificationLocalOverlayItem
> =
  | {
      readonly kind: 'server';
      readonly viewerUid: string | null;
      readonly summaries: readonly T[];
    }
  | {
      readonly kind: 'suppress';
      readonly communityId: string;
    };

export function initialCommunityNotificationLocalOverlayState<
  T extends CommunityNotificationLocalOverlayItem
>(): CommunityNotificationLocalOverlayState<T> {
  return {
    viewerUid: null,
    serverSummaries: [],
    suppressedCommunityIds: [],
  };
}

export function reduceCommunityNotificationLocalOverlay<
  T extends CommunityNotificationLocalOverlayItem
>(
  state: CommunityNotificationLocalOverlayState<T>,
  event: CommunityNotificationLocalOverlayEvent<T>
): CommunityNotificationLocalOverlayState<T> {
  if (event.kind === 'suppress') {
    const communityId = String(event.communityId ?? '').trim();
    if (!communityId || state.suppressedCommunityIds.includes(communityId)) {
      return state;
    }

    return {
      ...state,
      suppressedCommunityIds: [...state.suppressedCommunityIds, communityId],
    };
  }

  const viewerChanged = state.viewerUid !== event.viewerUid;
  if (viewerChanged) {
    return {
      viewerUid: event.viewerUid,
      serverSummaries: event.summaries,
      suppressedCommunityIds: [],
    };
  }

  const currentServerIds = new Set(
    event.summaries.map((summary) => summary.communityId)
  );

  return {
    viewerUid: event.viewerUid,
    serverSummaries: event.summaries,
    // Enquanto o servidor ainda expõe o resumo antigo, a saída local continua
    // escondendo-o. Quando o listener agregado confirma sua remoção, descartamos
    // a supressão para que uma futura reentrada possa receber atividade nova.
    suppressedCommunityIds: state.suppressedCommunityIds.filter(
      (communityId) => currentServerIds.has(communityId)
    ),
  };
}

export function visibleCommunityNotificationSummaries<
  T extends CommunityNotificationLocalOverlayItem
>(state: CommunityNotificationLocalOverlayState<T>): readonly T[] {
  if (state.suppressedCommunityIds.length === 0) {
    return state.serverSummaries;
  }

  const suppressed = new Set(state.suppressedCommunityIds);
  return state.serverSummaries.filter(
    (summary) => !suppressed.has(summary.communityId)
  );
}
