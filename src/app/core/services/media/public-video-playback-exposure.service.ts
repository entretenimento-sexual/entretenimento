import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, map,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileVisibilityService } from 'src/app/core/services/discovery/public-profile-visibility.service';
import { combinePublicVideoExposure$ } from './public-media-availability-observer';

/**
 * Observa a publicação ativa, o perfil e a projeção bilateral canônica.
 * O bloqueio é observado pelo PublicProfileVisibilityService; não criar
 * duas assinaturas de acesso bilateral para um mesmo visualizador.
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
      const publicExposure$ = docSnapshots(publicRef).pipe(
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
      );

      if (ownerUid === viewerUid) return publicExposure$;
      return combinePublicVideoExposure$(
        publicExposure$, this.profileVisibility.watch$(ownerUid)
      );
    }).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }
}
