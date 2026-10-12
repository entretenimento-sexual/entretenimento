// Projeção privada derivada. Nunca substitui Rules ou Cloud Functions.
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, Observable, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

interface DirectChatAccessProjection {
  available?: unknown;
  version?: unknown;
}

@Injectable({ providedIn: 'root' })
export class DirectChatAvailabilityService {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly lastAttempt = new Map<string, number>();
  private static readonly RETRY_AFTER_MS = 60_000;

  private reconcile$(owner: string, peer: string): Observable<boolean> {
    const key = JSON.stringify([owner, peer]);
    return defer(() => {
      let pending = this.inFlight.get(key);
      if (!pending) {
        const now = Date.now();
        if (now - (this.lastAttempt.get(key) ?? -Infinity) < DirectChatAvailabilityService.RETRY_AFTER_MS) {
          return of(false);
        }
        this.lastAttempt.set(key, now);
        const reconcile = runInInjectionContext(this.injector, () =>
          httpsCallable<{ peerUid: string }, { reconciled: boolean }>(
            this.functions, 'reconcileDirectChatAccess'
          )
        );
        pending = Promise.resolve().then(() => reconcile({ peerUid: peer })).then(
          () => undefined,
          () => undefined
        );
        this.inFlight.set(key, pending);
        void pending.finally(() => {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        });
      }
      return from(pending).pipe(switchMap(() => of(false)));
    });
  }
  constructor(
    private readonly firestore: Firestore,
    private readonly injector: EnvironmentInjector,
    private readonly functions: Functions
  ) {}

  observe$(ownerUid: string, peerUid: string): Observable<boolean> {
    const owner = String(ownerUid ?? '').trim();
    const peer = String(peerUid ?? '').trim();
    if (!owner || !peer || owner === peer || owner.includes('/') || peer.includes('/')) {
      return of(false);
    }

    return defer(() => runInInjectionContext(this.injector, () => {
      const reference = doc(this.firestore, 'direct_chat_access', owner, 'peers', peer);
      return docData(reference) as Observable<DirectChatAccessProjection | undefined>;
    })).pipe(
      switchMap((projection) => {
        if (projection?.version === 1 && typeof projection.available === 'boolean') {
          return of(projection.available);
        }
        // Apenas a ausência ou formato legado solicita reconciliação.
        // A chamada não libera acesso; aguardamos o novo snapshot validado.
        return this.reconcile$(owner, peer);
      }),
      catchError(() => of(false))
    );
  }
}
