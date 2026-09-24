// src/app/community/discovery/community-discovery-sponsored.facade.ts
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, take } from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { CommunitySponsoredPlacement } from '../data-access/community-boost.model';
import { CommunityBoostRepository } from '../data-access/community-boost.repository';
import type {
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from '../data-access/community-preview.model';
import {
  COMMUNITY_BOOST_SESSION_ROTATION_CONTEXTS_MAX,
  buildCommunityBoostSessionExclusions,
  resolveCommunityBoostInsertionAfterIndex,
} from './community-boost-display.policy';
import { CommunityDiscoverySessionBehaviorService } from './community-discovery-session-behavior.service';

export interface CommunityDiscoverySponsoredContext {
  readonly sourceType: CommunityPreviewSourceType;
  readonly canFilterByTags: boolean;
  readonly tagId: string | null;
  readonly discoveryMode: 'explore' | 'mine';
}

@Injectable()
export class CommunityDiscoverySponsoredFacade {
  private readonly repository = inject(CommunityBoostRepository);
  private readonly sessionBehavior = inject(CommunityDiscoverySessionBehaviorService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lastSponsoredCommunityByContext = new Map<string, string>();
  private requestSequence = 0;

  readonly sponsoredPlacement = signal<CommunitySponsoredPlacement | null>(null);

  reset(): void {
    this.requestSequence += 1;
    this.sponsoredPlacement.set(null);
  }

  loadForPage(
    organicItems: readonly CommunityPreviewCard[],
    context: CommunityDiscoverySponsoredContext
  ): void {
    if (context.discoveryMode !== 'explore') {
      this.reset();
      return;
    }

    if (resolveCommunityBoostInsertionAfterIndex(organicItems.length) === null) {
      this.reset();
      return;
    }

    const requestSequence = ++this.requestSequence;
    this.sponsoredPlacement.set(null);

    this.sessionBehavior.state$
      .pipe(
        take(1),
        switchMap((sessionBehavior) => {
          const rotationContext = this.rotationContext(context);
          const excludedCommunityIds = buildCommunityBoostSessionExclusions({
            lastSponsoredCommunityId:
              this.lastSponsoredCommunityByContext.get(rotationContext) ?? null,
            hiddenCommunityIds: sessionBehavior.hiddenCommunityIds,
          });

          return this.repository.getPlacement$({
            sourceType: context.sourceType,
            tagId: context.canFilterByTags ? context.tagId : null,
            organicCommunityIds: organicItems.map((item) => item.communityId),
            excludedCommunityIds,
          });
        }),
        catchError((error: unknown) => {
          this.reportError(error, 'getCommunityBoostPlacement', context);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((placement) => {
        if (requestSequence !== this.requestSequence) return;

        if (placement) {
          this.rememberSponsoredCommunity(
            this.rotationContext(context),
            placement.community.communityId
          );
        }
        this.sponsoredPlacement.set(placement);
      });
  }

  recordQualifiedExposure(
    placement: CommunitySponsoredPlacement,
    context: CommunityDiscoverySponsoredContext
  ): void {
    if (context.discoveryMode !== 'explore') return;

    this.repository.recordEvent$(placement.placementId, 'qualified_exposure')
      .pipe(
        catchError((error: unknown) => {
          this.reportError(
            error,
            'recordCommunityBoostExposure',
            context
          );
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  recordClick(
    placement: CommunitySponsoredPlacement,
    context: CommunityDiscoverySponsoredContext
  ): void {
    if (context.discoveryMode !== 'explore') return;

    this.repository.recordEvent$(placement.placementId, 'click')
      .pipe(
        catchError((error: unknown) => {
          this.reportError(error, 'recordCommunityBoostClick', context);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  dismiss(
    placement: CommunitySponsoredPlacement,
    context: CommunityDiscoverySponsoredContext
  ): void {
    const communityId = String(placement.community.communityId ?? '').trim();
    if (!communityId) return;

    this.rememberSponsoredCommunity(this.rotationContext(context), communityId);
    this.sponsoredPlacement.set(null);
  }

  placementAfter(
    itemIndex: number,
    organicCardCount: number
  ): CommunitySponsoredPlacement | null {
    const placement = this.sponsoredPlacement();
    if (!placement) return null;

    return resolveCommunityBoostInsertionAfterIndex(organicCardCount) === itemIndex
      ? placement
      : null;
  }

  private rotationContext(
    context: CommunityDiscoverySponsoredContext
  ): string {
    return [
      context.sourceType,
      context.canFilterByTags ? context.tagId ?? 'all' : 'all',
    ].join('|');
  }

  private rememberSponsoredCommunity(
    context: string,
    communityId: string
  ): void {
    const normalizedCommunityId = String(communityId ?? '').trim();
    if (!normalizedCommunityId) return;

    this.lastSponsoredCommunityByContext.delete(context);
    this.lastSponsoredCommunityByContext.set(context, normalizedCommunityId);

    while (
      this.lastSponsoredCommunityByContext.size
      > COMMUNITY_BOOST_SESSION_ROTATION_CONTEXTS_MAX
    ) {
      const oldestContext =
        this.lastSponsoredCommunityByContext.keys().next().value;
      if (typeof oldestContext !== 'string') break;
      this.lastSponsoredCommunityByContext.delete(oldestContext);
    }
  }

  private reportError(
    error: unknown,
    operation: string,
    context: CommunityDiscoverySponsoredContext
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage:
        'O conteúdo patrocinado não pôde ser atualizado agora.',
      notification: 'none',
      metadata: {
        scope: 'CommunityDiscoverySponsoredFacade',
        sourceType: context.sourceType,
        discoveryMode: context.discoveryMode,
        tagId: context.tagId,
        sponsored: true,
      },
    });
  }
}
