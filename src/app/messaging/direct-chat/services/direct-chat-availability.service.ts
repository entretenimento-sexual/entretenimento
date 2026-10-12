// Projeção privada derivada. Nunca substitui Rules ou Cloud Functions.
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { defer, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

interface DirectChatAccessProjection {
  available?: unknown;
  version?: unknown;
}

@Injectable({ providedIn: 'root' })
export class DirectChatAvailabilityService {
  constructor(
    private readonly firestore: Firestore,
    private readonly injector: EnvironmentInjector
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
      // Projeção ausente ou sem versão reconhecida permanece indisponível.
      // O backend/Rules continuam sendo a autoridade de autorização.
      map(projection => projection?.version === 1 && projection.available === true),
      // Falha na observação não deve deixar dados privados em tela.
      catchError(() => of(false))
    );
  }
}
