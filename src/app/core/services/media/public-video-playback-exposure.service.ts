import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, ignoreElements, map,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { resolvePublicMediaAvailability } from './public-media-availability.policy';
import {
  combinePublicVideoExposure$, watchPublicMediaAvailability$,
} from './public-media-availability-observer';

/**
 * One short-lived read listener for the current public projection, plus the
 * private bilateral projection for this viewer/owner pair. No global polling
 * and no per-card subscriptions. Signed URL issuance remains backend-authoritative.
 *
 * The projection is backend-only and direction-neutral. A missing legacy
 * projection is reconciled once via a rate-limited callable; it never grants
 * access by itself. This listener is only a local playback revocation signal.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoPlaybackExposureService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);
  private readonly functions = inject(Functions);

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

      // Neither direction of canonical blocks is exposed to this client.
      // The backend mirrors only a neutral boolean in the viewer's own scope.
      const bilateralAccessRef = doc(
        this.db, `public_media_access/${viewerUid}/owners/${ownerUid}`
      );
      const bilateralAllowed$ = watchPublicMediaAvailability$(
        docSnapshots(bilateralAccessRef).pipe(
          map((snapshot) => resolvePublicMediaAvailability(
            snapshot.exists() ? snapshot.data() : null
          ))
        ),
        () => this.reconcileLegacyPair$(ownerUid)
      ).pipe(catchError(() => of(false)));
      return combinePublicVideoExposure$(publicExposure$, bilateralAllowed$);
    }).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }

  private reconcileLegacyPair$(ownerUid: string): Observable<false> {
    return this.context.deferPromise$(async () => {
      const callable = httpsCallable<
        { ownerUid: string }, { reconciled: true }
      >(this.functions, 'reconcilePublicMediaAccess');
      await callable({ ownerUid });
    }).pipe(
      // Do not emit false on success before the new snapshot arrives, because
      // that would permanently revoke an otherwise authorized open viewer.
      ignoreElements(),
      // Legacy or unavailable backends fail closed without a polling loop.
      catchError(() => of(false as const))
    );
  }
}
