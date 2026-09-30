import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

export interface VisitedProfileFriendshipRelation {
  isFriend: boolean;
  hasPendingOutboundRequest: boolean;
}

const EMPTY_RELATION: VisitedProfileFriendshipRelation = {
  isFriend: false,
  hasPendingOutboundRequest: false,
};

@Injectable()
export class VisitedProfileFriendshipFacade {
  constructor(
    private readonly friendshipService: FriendshipService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  observe$(
    viewerUid$: Observable<string>,
    targetUid$: Observable<string>
  ): Observable<VisitedProfileFriendshipRelation> {
    return combineLatest([
      viewerUid$.pipe(distinctUntilChanged()),
      targetUid$.pipe(distinctUntilChanged()),
    ]).pipe(
      switchMap(([viewerUid, targetUid]) => {
        const safeViewerUid = String(viewerUid ?? '').trim();
        const safeTargetUid = String(targetUid ?? '').trim();

        if (
          !safeViewerUid ||
          !safeTargetUid ||
          safeViewerUid === safeTargetUid
        ) {
          return of(EMPTY_RELATION);
        }

        return combineLatest([
          this.friendshipService.watchOutboundRequests(safeViewerUid).pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'VisitedProfileFriendshipFacade.watchOutboundRequests',
                safeTargetUid
              );
              return of([]);
            })
          ),
          this.friendshipService.watchFriends(safeViewerUid).pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'VisitedProfileFriendshipFacade.watchFriends',
                safeTargetUid
              );
              return of([]);
            })
          ),
        ]).pipe(
          map(([outboundRequests, friends]) => ({
            isFriend: (friends ?? []).some(
              (friend) =>
                String(friend?.friendUid ?? '').trim() === safeTargetUid
            ),
            hasPendingOutboundRequest: (outboundRequests ?? []).some(
              (request) =>
                String(request?.targetUid ?? '').trim() === safeTargetUid &&
                request?.status === 'pending'
            ),
          }))
        );
      }),
      distinctUntilChanged(
        (a, b) =>
          a.isFriend === b.isFriend &&
          a.hasPendingOutboundRequest === b.hasPendingOutboundRequest
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private reportSilent(
    error: unknown,
    operation: string,
    targetUid: string
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-view',
      operation,
      fallbackMessage:
        'Não foi possível atualizar o estado de conexão deste perfil.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'VisitedProfileFriendshipFacade',
        hasTargetUid: !!targetUid,
      },
    });
  }
}
