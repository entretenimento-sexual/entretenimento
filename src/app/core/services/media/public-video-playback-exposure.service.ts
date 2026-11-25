import { Injectable, InjectionToken, inject } from '@angular/core';
import { Firestore, doc, docSnapshots, type DocumentReference, type DocumentSnapshot } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, map, switchMap,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileVisibilityService } from 'src/app/core/services/discovery/public-profile-visibility.service';


export const PUBLIC_MEDIA_EXPOSURE_FIRESTORE = new InjectionToken<{
  doc(db: Firestore, path: string): DocumentReference;
  docSnapshots(ref: DocumentReference): Observable<DocumentSnapshot>;
}>('PUBLIC_MEDIA_EXPOSURE_FIRESTORE', {
  providedIn: 'root',
  factory: () => ({
    doc: (db, path) => doc(db, path),
    docSnapshots: (ref) => docSnapshots(ref),
  }),
});

/**
 * A autorização do perfil governa o ciclo de vida do listener da mídia.
 * Enquanto o perfil está oculto, nenhum listener de mídia permanece ativo.
 * Após restaurar acesso, uma NOVA assinatura recupera o documento público,
 * inclusive se a antiga terminou com permission-denied durante exclusão.
 * Uma resposta de cache ou uma URL assinada antiga nunca concede acesso.
 */
export function watchMediaAfterProfileAvailability$(
  profileAvailable$: Observable<boolean>,
  watchMedia$: () => Observable<boolean>
): Observable<boolean> {
  return profileAvailable$.pipe(
    distinctUntilChanged(),
    switchMap((available) => available
      ? watchMedia$().pipe(catchError(() => of(false)))
      : of(false)
    ),
    distinctUntilChanged()
  );
}

/**
 * Observa a publicação ativa, o perfil e a projeção bilateral canônica.
 * O bloqueio é observado pelo PublicProfileVisibilityService; não criar
 * duas assinaturas de acesso bilateral para um mesmo visualizador.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoPlaybackExposureService {
  private readonly db = inject(Firestore);
  private readonly firestoreApi = inject(PUBLIC_MEDIA_EXPOSURE_FIRESTORE);
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

    // Every availability transition creates a fresh listener inside DI.
    const watchPublicExposure$ = () => this.context.deferObservable$(() => {
      const publicRef = this.firestoreApi.doc(
        this.db, `public_profiles/${ownerUid}/${collectionName}/${mediaId}`
      );
      return this.firestoreApi.docSnapshots(publicRef).pipe(
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
    });

    return (ownerUid === viewerUid
      ? watchPublicExposure$()
      : watchMediaAfterProfileAvailability$(
          this.profileVisibility.watch$(ownerUid),
          watchPublicExposure$
        )
    ).pipe(
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }
}
