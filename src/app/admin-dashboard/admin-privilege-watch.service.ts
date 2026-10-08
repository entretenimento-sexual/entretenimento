import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, onSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';

/** Encapsula o listener remoto para permitir testes determinísticos de sessão. */
@Injectable({ providedIn: 'root' })
export class AdminPrivilegeWatchService {
  constructor(private readonly firestore: Firestore) {}

  watch(uid: string): Observable<boolean> {
    return new Observable<boolean>((subscriber) =>
      onSnapshot(
        doc(this.firestore, 'users', uid),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache) {
            subscriber.next(false);
            return;
          }
          const value = snapshot.exists() ? snapshot.data() : null;
          subscriber.next(!!value
            && (value['accountStatus'] == null || value['accountStatus'] === 'active')
            && value['suspended'] !== true
            && value['accountLocked'] !== true
            && value['interactionBlocked'] !== true
            && value['loginAllowed'] !== false
            && (value['role'] === 'admin'
              || value['admin'] === true
              || value['superadmin'] === true));
        },
        (error) => subscriber.error(error)
      )
    );
  }
}
