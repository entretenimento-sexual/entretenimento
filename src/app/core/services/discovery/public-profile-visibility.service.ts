import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  Firestore, doc, docSnapshots, type DocumentReference, type DocumentSnapshot,
} from '@angular/fire/firestore';
import { Observable, concat, defer, of, timer } from 'rxjs';
import {
  catchError, distinctUntilChanged, exhaustMap, filter, map, repeat, switchMap, take, timeout,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileReadBoundaryService } from 'src/app/core/services/discovery/public-profile-read-boundary.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PublicBilateralMediaAvailabilityService } from 'src/app/core/services/media/public-bilateral-media-availability.service';

interface PublicProfileVisibilityFirestore {
  doc(db: Firestore, path: string): DocumentReference;
  docSnapshots(ref: DocumentReference): Observable<DocumentSnapshot>;
}

// Keep the production adapter on AngularFire; tests can substitute only the
// transport while exercising the real injection context and recovery pipeline.
export const PUBLIC_PROFILE_VISIBILITY_FIRESTORE =
  new InjectionToken<PublicProfileVisibilityFirestore>('PUBLIC_PROFILE_VISIBILITY_FIRESTORE', {
    providedIn: 'root',
    factory: () => ({
      doc: (db, path) => doc(db, path),
      docSnapshots: (ref) => docSnapshots(ref),
    }),
  });

const RECHECK_INTERVAL_MS = 15_000;
const RECHECK_TIMEOUT_MS = 5_000;

/** Não representa acesso à mídia: apenas sinaliza mudança na lista pública. */
export interface PublicProfileMediaIndexState {
  readonly available: boolean;
  readonly mediaRevision: number;
}

const UNAVAILABLE_MEDIA_INDEX: PublicProfileMediaIndexState = Object.freeze({
  available: false,
  mediaRevision: 0,
});

export function samePublicProfileMediaIndex(
  left: PublicProfileMediaIndexState,
  right: PublicProfileMediaIndexState
): boolean {
  return left.available === right.available &&
    left.mediaRevision === right.mediaRevision;
}

function revisionFromPublicProfile(data: Record<string, unknown> | undefined):
  number {
  const revision = Number(data?.['publicMediaRevision'] ?? 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

/**
 * Disponibilidade do perfil público visitado: somente um UID em foco.
 * Firestore transmite revogação imediata; fallback sanitizado consulta o
 * backend quando o documento se tornou inacessível (legado/bloqueio).
 * Um cache local NUNCA autoriza exibir dados privados ou mídia.
 */
/** Revogação imediata e nova assinatura da projeção após unblock. */
export function watchBilateralProfileVisibility$<T = boolean>(
  bilateralAllowed$: Observable<boolean>,
  watchOwner$: () => Observable<T>,
  denied: T = false as T
): Observable<T> {
  return bilateralAllowed$.pipe(
    switchMap((allowed) => allowed ? watchOwner$() : of(denied)),
    distinctUntilChanged()
  );
}

/** Revoga no erro e restabelece a escuta somente após confirmação do backend. */
export function watchPublicProfileMediaIndexWithRecovery$(
  watchCanonical$: () => Observable<PublicProfileMediaIndexState>,
  probeRecovery$: () => Observable<boolean>
): Observable<PublicProfileMediaIndexState> {
  return defer(watchCanonical$).pipe(
    catchError(() => concat(
      of(UNAVAILABLE_MEDIA_INDEX),
      defer(probeRecovery$).pipe(
        filter(Boolean),
        take(1),
        map(() => UNAVAILABLE_MEDIA_INDEX)
      )
    )),
    repeat({ delay: () => timer(RECHECK_INTERVAL_MS) }),
    distinctUntilChanged(samePublicProfileMediaIndex)
  );
}

@Injectable({ providedIn: 'root' })
export class PublicProfileVisibilityService {
  private readonly db = inject(Firestore);
  private readonly firestoreApi = inject(PUBLIC_PROFILE_VISIBILITY_FIRESTORE);
  private readonly context = inject(FirestoreContextService);
  private readonly publicRead = inject(PublicProfileReadBoundaryService);
  private readonly authSession = inject(AuthSessionService);
  private readonly bilateral = inject(PublicBilateralMediaAvailabilityService);

  watch$(ownerUid: string): Observable<boolean> {
    return this.watchMediaIndex$(ownerUid).pipe(
      map(({ available }) => available),
      distinctUntilChanged()
    );
  }

  /**
   * Único observador canônico por UID para galeria: lifecycle, bloqueio
   * bilateral e revisão pública. Uma alteração da revisão NUNCA concede
   * acesso: sempre exige a leitura autorizada na próxima paginação.
   */
  watchMediaIndex$(ownerUid: string): Observable<PublicProfileMediaIndexState> {
    const uid = String(ownerUid ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return of(UNAVAILABLE_MEDIA_INDEX);

    return this.authSession.uid$.pipe(
      switchMap((viewerUid) => {
        if (!viewerUid) return of(UNAVAILABLE_MEDIA_INDEX);
        if (viewerUid === uid) return this.watchOwnerProfileIndex$(uid);

        // Troca de conta/bloqueio revogam antes de escutar a projeção.
        return watchBilateralProfileVisibility$(
          this.bilateral.watch$(uid, viewerUid),
          () => this.watchOwnerProfileIndex$(uid),
          UNAVAILABLE_MEDIA_INDEX
        );
      }),
      distinctUntilChanged(samePublicProfileMediaIndex),
      catchError(() => of(UNAVAILABLE_MEDIA_INDEX))
    );
  }

  private watchOwnerProfileIndex$(
    uid: string
  ): Observable<PublicProfileMediaIndexState> {
    // Recovery invokes this factory again outside the original injection context.
    const watchCanonical$ = () => this.context.deferObservable$(() => {
      const ref = this.firestoreApi.doc(this.db, `public_profiles/${uid}`);
      return this.firestoreApi.docSnapshots(ref).pipe(
        map((snapshot): PublicProfileMediaIndexState => {
          if (snapshot.metadata.fromCache ||
              snapshot.metadata.hasPendingWrites ||
              !snapshot.exists()) {
            return UNAVAILABLE_MEDIA_INDEX;
          }
          return {
            available: true,
            mediaRevision: revisionFromPublicProfile(
              snapshot.data() as Record<string, unknown>
            ),
          };
        })
      );
    });

    return watchPublicProfileMediaIndexWithRecovery$(
      watchCanonical$,
      () => timer(0, RECHECK_INTERVAL_MS).pipe(
        exhaustMap(() => this.publicRead.readByUids$([uid]).pipe(
          timeout({ first: RECHECK_TIMEOUT_MS }),
          map(({ items }) => items.some((item) => item['uid'] === uid)),
          catchError(() => of(false))
        ))
      )
    ).pipe(
      catchError(() => of(UNAVAILABLE_MEDIA_INDEX)),
      distinctUntilChanged(samePublicProfileMediaIndex)
    );
  }

}
