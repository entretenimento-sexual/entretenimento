import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, ignoreElements, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { resolvePublicMediaAvailability } from './public-media-availability.policy';
import { watchPublicMediaAvailability$ } from './public-media-availability-observer';

const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Única observação cliente da projeção bilateral sem direção/reason/actor.
 * O backend é autoridade: a ausência do documento antigo dispara apenas
 * reconciliação; uma resposta HTTP jamais concede autorização.
 */
@Injectable({ providedIn: 'root' })
export class PublicBilateralMediaAvailabilityService {
  private readonly db = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly context = inject(FirestoreContextService);

  watch$(ownerUid: string, viewerUid: string): Observable<boolean> {
    if (!SAFE_UID.test(ownerUid) || !SAFE_UID.test(viewerUid)) return of(false);
    if (ownerUid === viewerUid) return of(true);

    return this.context.deferObservable$(() => {
      const projectionRef = doc(
        this.db, `public_media_access/${viewerUid}/owners/${ownerUid}`
      );
      return watchPublicMediaAvailability$(
        docSnapshots(projectionRef).pipe(
          map((snapshot) => {
            // Não promover concessões antigas do cache a permissão atual.
            if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
              return null;
            }
            return resolvePublicMediaAvailability(
              snapshot.exists() ? snapshot.data() : null
            );
          })
        ),
        () => this.reconcileLegacyPair$(ownerUid)
      ).pipe(catchError(() => of(false)));
    }).pipe(catchError(() => of(false)));
  }

  private reconcileLegacyPair$(ownerUid: string): Observable<false> {
    return this.context.deferPromise$(async () => {
      const callable = httpsCallable<
        { ownerUid: string }, { reconciled: true }
      >(this.functions, 'reconcilePublicMediaAccess');
      await callable({ ownerUid });
    }).pipe(
      // Apenas o próximo snapshot canônico pode conceder acesso.
      ignoreElements(),
      catchError(() => of(false as const))
    );
  }
}
