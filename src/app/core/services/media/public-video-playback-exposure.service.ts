import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, timer } from 'rxjs';
import {
  catchError, distinctUntilChanged, exhaustMap, filter, ignoreElements, map, timeout,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileReadBoundaryService } from 'src/app/core/services/discovery/public-profile-read-boundary.service';
import { resolvePublicMediaAvailability } from './public-media-availability.policy';
import {
  combinePublicVideoExposure$, watchPublicMediaAvailability$,
} from './public-media-availability-observer';

const LEGACY_OWNER_RECHECK_INTERVAL_MS = 15_000;
const LEGACY_OWNER_RECHECK_TIMEOUT_MS = 5_000;

/**
 * Observe only the open video, its owner's public profile and the bilateral
 * projection for the viewer/owner pair. Signed URL issuance stays in the backend.
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
  private readonly publicProfileRead = inject(PublicProfileReadBoundaryService);

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

      // Account suspension removes this document but leaves the child video
      // projection in place. Watch the document the transaction actually writes.
      const ownerProfileAvailable$ = this.watchOwnerProfile$(ownerUid);

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
      return combinePublicVideoExposure$(
        publicExposure$, bilateralAllowed$, ownerProfileAvailable$
      );
    }).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }

  private watchOwnerProfile$(ownerUid: string): Observable<boolean> {
    const ref = doc(this.db, `public_profiles/${ownerUid}`);
    let receivedServerSnapshot = false;

    // AngularFire's docSnapshots includes server metadata changes.
    return docSnapshots(ref).pipe(
      filter((snapshot) =>
        !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
      ),
      map((snapshot) => {
        receivedServerSnapshot = true;
        return snapshot.exists();
      }),
      catchError((error: { code?: string } | null) => {
        if (receivedServerSnapshot || error?.code !== 'permission-denied') {
          return of(false);
        }

        // Legacy projections with private fields cannot be watched directly.
        // Keep the backend's sanitized read in charge while this player is open.
        return timer(0, LEGACY_OWNER_RECHECK_INTERVAL_MS).pipe(
          exhaustMap(() => this.publicProfileRead.readByUids$([ownerUid]).pipe(
            timeout({ first: LEGACY_OWNER_RECHECK_TIMEOUT_MS }),
            map(({ items }) => items.some((item) => item['uid'] === ownerUid)),
            catchError(() => of(false))
          ))
        );
      })
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
