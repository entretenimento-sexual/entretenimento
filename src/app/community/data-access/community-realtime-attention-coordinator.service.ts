import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  distinctUntilChanged,
  fromEvent,
  map,
  of,
  shareReplay,
  startWith,
} from 'rxjs';

export type CommunityRealtimeAttentionMode = 'detailed' | 'aggregate';

interface CommunityRealtimeLease {
  readonly id: number;
  readonly communityId: string;
}

const SAFE_COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * Coordena o único stream detalhado permitido entre superfícies de Comunidade.
 *
 * - o lease mais recente representa a Comunidade em primeiro plano;
 * - leases anteriores permanecem montados, mas recebem modo `aggregate`;
 * - ao liberar o primeiro plano, o lease anterior volta a poder ser detalhado;
 * - aba/documento oculto força todos os leases para `aggregate`;
 * - o resumo agregado é independente deste serviço e continua com um listener
 *   único por usuário em CommunityNotificationUnreadSummaryService.
 */
@Injectable({ providedIn: 'root' })
export class CommunityRealtimeAttentionCoordinatorService {
  private readonly document = inject(DOCUMENT);
  private readonly activeLeaseSubject =
    new BehaviorSubject<CommunityRealtimeLease | null>(null);
  private readonly leases: CommunityRealtimeLease[] = [];
  private nextLeaseId = 1;

  private readonly documentVisible$ = fromEvent(
    this.document,
    'visibilitychange'
  ).pipe(
    startWith(null),
    map(() => this.document.visibilityState !== 'hidden'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  claimMode$(
    communityIdValue: string
  ): Observable<CommunityRealtimeAttentionMode> {
    const communityId = String(communityIdValue ?? '').trim();

    if (!SAFE_COMMUNITY_ID_PATTERN.test(communityId)) {
      return of('aggregate');
    }

    return new Observable<CommunityRealtimeAttentionMode>((subscriber) => {
      const lease: CommunityRealtimeLease = {
        id: this.nextLeaseId++,
        communityId,
      };

      this.leases.push(lease);
      this.publishForeground();

      const subscription = combineLatest([
        this.activeLeaseSubject,
        this.documentVisible$,
      ]).pipe(
        map(([activeLease, documentVisible]) =>
          activeLease?.id === lease.id && documentVisible
            ? 'detailed' as const
            : 'aggregate' as const
        ),
        distinctUntilChanged()
      ).subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        const index = this.leases.findIndex((candidate) => candidate.id === lease.id);
        if (index >= 0) {
          this.leases.splice(index, 1);
        }
        this.publishForeground();
      };
    });
  }

  modeForCommunity$(
    communityIdValue: string
  ): Observable<CommunityRealtimeAttentionMode> {
    const communityId = String(communityIdValue ?? '').trim();

    if (!SAFE_COMMUNITY_ID_PATTERN.test(communityId)) {
      return of('aggregate');
    }

    return combineLatest([
      this.activeLeaseSubject,
      this.documentVisible$,
    ]).pipe(
      map(([activeLease, documentVisible]) =>
        activeLease?.communityId === communityId && documentVisible
          ? 'detailed' as const
          : 'aggregate' as const
      ),
      distinctUntilChanged()
    );
  }

  private publishForeground(): void {
    this.activeLeaseSubject.next(this.leases.at(-1) ?? null);
  }
}
