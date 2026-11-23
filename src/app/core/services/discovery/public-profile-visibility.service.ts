import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Observable, concat, of, timer } from 'rxjs';
import {
  catchError, distinctUntilChanged, exhaustMap, map, switchMap, timeout,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicProfileReadBoundaryService } from 'src/app/core/services/discovery/public-profile-read-boundary.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PublicBilateralMediaAvailabilityService } from 'src/app/core/services/media/public-bilateral-media-availability.service';
import { combinePublicVideoExposure$ } from 'src/app/core/services/media/public-media-availability-observer';

const RECHECK_INTERVAL_MS = 15_000;
const RECHECK_TIMEOUT_MS = 5_000;

/**
 * Disponibilidade do perfil público visitado: somente um UID em foco.
 * Firestore transmite revogação imediata; fallback sanitizado consulta o
 * backend quando o documento se tornou inacessível (legado/bloqueio).
 * Um cache local NUNCA autoriza exibir dados privados ou mídia.
 */
@Injectable({ providedIn: 'root' })
export class PublicProfileVisibilityService {
  private readonly db = inject(Firestore);
  private readonly context = inject(FirestoreContextService);
  private readonly publicRead = inject(PublicProfileReadBoundaryService);
  private readonly authSession = inject(AuthSessionService);
  private readonly bilateral = inject(PublicBilateralMediaAvailabilityService);

  watch$(ownerUid: string): Observable<boolean> {
    const uid = String(ownerUid ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return of(false);

    // Escopa a autorização ao UID autenticado vigente; troca de conta
    // cancela imediatamente observações do visitante anterior.
    return this.authSession.uid$.pipe(
      switchMap((viewerUid) => {
        if (!viewerUid) return of(false);
        const ownerVisible$ = this.watchOwnerProfile$(uid);
        if (viewerUid === uid) return ownerVisible$;

        // O bloco é atualizado sem alterar public_profiles. A projeção
        // bilateral é portanto necessária para revogar uma página já aberta.
        return combinePublicVideoExposure$(
          ownerVisible$, this.bilateral.watch$(uid, viewerUid)
        );
      }),
      distinctUntilChanged(),
      catchError(() => of(false))
    );
  }

  private watchOwnerProfile$(uid: string): Observable<boolean> {
    return this.context.deferObservable$(() => {
      const ref = doc(this.db, `public_profiles/${uid}`);
      return docSnapshots(ref).pipe(
        // Não promover projeções em cache a autorização atual.
        map((snapshot) => 
          !snapshot.metadata.fromCache &&
          !snapshot.metadata.hasPendingWrites &&
          snapshot.exists()
        ),
        catchError(() => of(false)),
        switchMap((available) => available
          ? of(true)
          : concat(
              of(false),
              // Necessário para recuperar o perfil sem refresh se o listener
              // terminou com permission-denied durante a suspensão.
              timer(0, RECHECK_INTERVAL_MS).pipe(
                exhaustMap(() => this.publicRead.readByUids$([uid]).pipe(
                  timeout({ first: RECHECK_TIMEOUT_MS }),
                  map(({ items }) => items.some((item) => item['uid'] === uid)),
                  catchError(() => of(false))
                ))
              )
            )
        ),
        distinctUntilChanged()
      );
    }).pipe(catchError(() => of(false)), distinctUntilChanged());
  }
}
