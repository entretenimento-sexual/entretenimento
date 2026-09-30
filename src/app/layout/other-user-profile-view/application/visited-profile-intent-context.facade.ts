import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';

export interface VisitedProfileIntentContextVm {
  title: string;
  detail: string;
}

@Injectable()
export class VisitedProfileIntentContextFacade {
  constructor(
    private readonly userIntentStatus: UserIntentStatusService
  ) {}

  observe$(
    viewerUid$: Observable<string>,
    targetUid$: Observable<string>
  ): Observable<VisitedProfileIntentContextVm | null> {
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
          return of(null);
        }

        return this.userIntentStatus
          .watchCurrentStatus$(safeViewerUid)
          .pipe(
            switchMap((viewerStatus) => {
              const options = {
                limit: 1,
                ownerUids: [safeTargetUid],
              };

              const targetStatuses$ = viewerStatus?.isActive
                ? this.userIntentStatus.watchActiveStatusesForRegion$(
                    viewerStatus.destination.region,
                    options
                  )
                : this.userIntentStatus.watchActiveStatusesForUserRegion$(
                    safeViewerUid,
                    options
                  );

              return targetStatuses$.pipe(
                map((targetStatuses) => {
                  const targetStatus = targetStatuses[0] ?? null;

                  if (!targetStatus?.isActive) {
                    return null;
                  }

                  if (
                    targetStatus.availability === 'available_now' &&
                    viewerStatus?.isActive === true &&
                    viewerStatus.availability === 'available_now'
                  ) {
                    return {
                      title: 'Vocês estão disponíveis agora',
                      detail: 'Status temporário em comum',
                    };
                  }

                  switch (targetStatus.availability) {
                    case 'available_now':
                      return {
                        title: 'Disponível agora',
                        detail: 'Status temporário',
                      };
                    case 'available_today':
                      return {
                        title: 'Disponível hoje',
                        detail: 'Status temporário',
                      };
                    case 'planning_later':
                      return {
                        title: 'Planejando mais tarde',
                        detail: 'Status temporário',
                      };
                    default:
                      return null;
                  }
                })
              );
            })
          );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}
