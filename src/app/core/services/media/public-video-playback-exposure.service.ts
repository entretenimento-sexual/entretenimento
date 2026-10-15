import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';

/**
 * One short-lived read listener for the current public projection, plus the
 * viewer's own outgoing block against its owner. No global polling and no
 * per-card subscriptions. Signed URL issuance remains backend-authoritative.
 *
 * Incoming block and owner lifecycle can also deny the public projection
 * listener via Firestore Rules. A listener is a UI revocation signal, not a
 * substitute for authorization on every new signed URL.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoPlaybackExposureService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);

  watchActiveVideo$(
    ownerUid: string,
    videoId: string,
    viewerUid: string
  ): Observable<boolean> {
    const validId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
    if (![ownerUid, videoId, viewerUid].every(validId)) {
      return of(false);
    }

    return this.context.deferObservable$(() => {
      const publicRef = doc(
        this.db, `public_profiles/${ownerUid}/public_videos/${videoId}`
      );
      const publicExposure$ = docSnapshots(publicRef).pipe(
        map((snapshot) => {
          const data = snapshot.data();
          return snapshot.exists() &&
            data?.['visibility'] === 'PUBLIC' &&
            data?.['moderationStatus'] === 'APPROVED';
        }),
        catchError(() => of(false))
      );

      if (ownerUid === viewerUid) {
        return publicExposure$;
      }

      // Incoming block records are intentionally not readable by the viewer.
      // We can directly observe only the viewer-owned outgoing block.
      const outgoingBlockRef = doc(
        this.db, `users/${viewerUid}/blocks/${ownerUid}`
      );
      const outgoingAllowed$ = docSnapshots(outgoingBlockRef).pipe(
        map((snapshot) => snapshot.data()?.['isBlocked'] !== true),
        catchError(() => of(false))
      );
      return combineLatest([publicExposure$, outgoingAllowed$]).pipe(
        map(([exposable, notBlocked]) => exposable && notBlocked)
      );
    }).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }
}
