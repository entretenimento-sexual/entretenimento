import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, filter, ignoreElements, map,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileVisibilityService } from 'src/app/core/services/discovery/public-profile-visibility.service';
import { resolvePublicMediaAvailability } from './public-media-availability.policy';
import {
  combinePublicVideoExposure$, watchPublicMediaAvailability$,
} from './public-media-availability-observer';

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
  private readonly profileVisibility = inject(PublicProfileVisibilityService);

  watchActiveVideo$(
    ownerUid: string,
    videoId: string,
    viewerUid: string
  ): Observable<boolean> {
    return this.watchActiveMedia$('public_videos', ownerUid, videoId, viewerUid);
  }

  /** Mesma fronteira de revogação aplicada a fotografias já abertas. */
  watchActivePhoto$(
    ownerUid: string,
    photoId: string,
    viewerUid: string
  ): Observable<boolean> {
    return this.watchActiveMedia$('public_photos', ownerUid, photoId, viewerUid);
  }

  private watchActiveMedia$(
    collectionName: 'public_videos' | 'public_photos',
    ownerUid: string,
    mediaId: string,
    viewerUid: string
  ): Observable<boolean> {
    const validId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
    if (![ownerUid, mediaId, viewerUid].every(validId)) return of(false);

    return this.context.deferObservable$(() => {
      const publicRef = doc(
        this.db, `public_profiles/${ownerUid}/${collectionName}/${mediaId}`
      );
      const publicExposure$ = docSnapshots(publicRef).pipe(
        filter((snapshot) =>
          !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
        ),
        map((snapshot) => {
          const data = snapshot.data();
          return snapshot.exists() &&
            (data?.['visibility'] === 'PUBLIC' ||
              (collectionName === 'public_photos' && data?.['visibility'] === 'FRIENDS')) &&
            data?.['moderationStatus'] === 'APPROVED';
        }),
        catchError(() => of(false))
      );

      if (ownerUid === viewerUid) return publicExposure$;

      const ownerProfileAvailable$ = this.profileVisibility.watch$(ownerUid);
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
