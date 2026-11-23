import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, map, switchMap,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileVisibilityService } from 'src/app/core/services/discovery/public-profile-visibility.service';

/**
 * A media listener can terminate with permission-denied when its parent's
 * public profile is removed. An account restored later MUST create a fresh
 * listener, not reuse the terminated listener and its last false result.
 *
 * Owner access is the source of truth for lifecycle + bilateral restrictions.
 * No media document is read, or old signed URL granted, while it is false.
 */
export function watchPublicMediaAfterOwnerAuthorization$(
  ownerAuthorized$: Observable<boolean>,
  observeMedia$: () => Observable<boolean>
): Observable<boolean> {
  return ownerAuthorized$.pipe(
    distinctUntilChanged(),
    switchMap((authorized) => authorized
      ? observeMedia$().pipe(catchError(() => of(false)))
      : of(false)
    ),
    distinctUntilChanged()
  );
}

/**
 * Observa o ciclo de autorização do perfil e a publicação atual. Quando a
 * conta é excluída/suspensa/bloqueada, desmonta a escuta da mídia ativa;
 * quando o backend restaurar acesso, cria uma escuta NOVA.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoPlaybackExposureService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);
  private readonly profileVisibility = inject(PublicProfileVisibilityService);

  watchActiveVideo$(
    ownerUid: string,
    videoId: string,
    viewerUid: string
  ): Observable<boolean> {
    return this.watchActiveMedia$('public_videos', ownerUid, videoId, viewerUid);
  }

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

      return watchPublicMediaAfterOwnerAuthorization$(
        this.profileVisibility.watch$(ownerUid),
        () => docSnapshots(publicRef).pipe(
          map((snapshot) => {
            if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
              return false;
            }
            const data = snapshot.data();
            return snapshot.exists() &&
              (data?.['visibility'] === 'PUBLIC' ||
                (collectionName === 'public_photos' && data?.['visibility'] === 'FRIENDS')) &&
              data?.['moderationStatus'] === 'APPROVED';
          }),
          catchError(() => of(false))
        )
      );
    }).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }
}
