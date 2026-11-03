import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

export interface VisitedProfileFriendshipRelation {
  isFriend: boolean;
  hasPendingOutboundRequest: boolean;
  /** Unknown on partial observer failure; never grant an action by default. */
  statusVerified: boolean;
  blockedByViewer: boolean;
}

const EMPTY_RELATION: VisitedProfileFriendshipRelation = {
  isFriend: false,
  hasPendingOutboundRequest: false,
  statusVerified: false,
  blockedByViewer: false,
};

@Injectable()
export class VisitedProfileFriendshipFacade {
  private readonly refreshSubject = new BehaviorSubject(0);

  /** Re-subscribe to both relationship sources after a recoverable error. */
  refresh(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

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
      this.refreshSubject,
    ]).pipe(
      switchMap(([viewerUid, targetUid]) => {
        const safeViewerUid = String(viewerUid ?? '').trim();
        const safeTargetUid = String(targetUid ?? '').trim();

        if (
          !safeViewerUid ||
          !safeTargetUid ||
          safeViewerUid === safeTargetUid
        ) {
          return of({
            viewerUid: safeViewerUid,
            targetUid: safeTargetUid,
            relation: EMPTY_RELATION,
          });
        }

        return combineLatest([
          this.friendshipService.watchOutboundRequests(safeViewerUid).pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'VisitedProfileFriendshipFacade.watchOutboundRequests',
                safeTargetUid
              );
              return of(null);
            })
          ),
          this.friendshipService.watchFriends(safeViewerUid).pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'VisitedProfileFriendshipFacade.watchFriends',
                safeTargetUid
              );
              return of(null);
            })
          ),
          this.friendshipService.watchBlocked(safeViewerUid, safeTargetUid).pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'VisitedProfileFriendshipFacade.watchBlocked',
                safeTargetUid
              );
              return of(null);
            })
          ),
        ]).pipe(
          map(([outboundRequests, friends, blocked]) => {
            const blockedByViewer = blocked === true;
            return {
              viewerUid: safeViewerUid,
              targetUid: safeTargetUid,
              relation: {
                // A known outgoing block disables all social actions.
                // Failure/unknown never becomes an inferred permission.
                statusVerified: blockedByViewer || (
                  typeof blocked === 'boolean' &&
                  Array.isArray(outboundRequests) &&
                  Array.isArray(friends)
                ),
                blockedByViewer,
                isFriend: !blockedByViewer && (friends ?? []).some(
                  (friend) =>
                    String(friend?.friendUid ?? '').trim() === safeTargetUid
                ),
                hasPendingOutboundRequest: !blockedByViewer && (outboundRequests ?? []).some(
                  (request) =>
                    String(request?.targetUid ?? '').trim() === safeTargetUid &&
                    request?.status === 'pending'
                ),
              },
            };
          }),
          // Before every new listener emits, revoke the previous state.
          startWith({
            viewerUid: safeViewerUid,
            targetUid: safeTargetUid,
            relation: EMPTY_RELATION,
          })
        );
      }),
      // Compare both the relationship and its source identities. A change
      // of viewer or profile must notify even if the flags are identical;
      // otherwise the UI may keep a previous profile's accessibility label.
      distinctUntilChanged(
        (a, b) =>
          a.viewerUid === b.viewerUid &&
          a.targetUid === b.targetUid &&
          a.relation.isFriend === b.relation.isFriend &&
          a.relation.hasPendingOutboundRequest === b.relation.hasPendingOutboundRequest &&
          a.relation.statusVerified === b.relation.statusVerified &&
          a.relation.blockedByViewer === b.relation.blockedByViewer
      ),
      map(({ relation }) => relation),
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
