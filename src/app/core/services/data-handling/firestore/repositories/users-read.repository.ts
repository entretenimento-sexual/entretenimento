//src\app\core\services\data-handling\firestore\repositories\users-read.repository.ts
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Firestore, doc, getDoc, docData, docSnapshots, getDocFromServer } from '@angular/fire/firestore';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { userConverter } from '@core/services/data-handling/converters/user.firestore-converter';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UsersReadRepository {
  constructor(
    private readonly db: Firestore,
    private readonly injector: Injector,
    private readonly firestoreError: FirestoreErrorHandlerService
  ) { }

  private usersCol() {
    return runInInjectionContext(this.injector, () =>
      collection(this.db, 'users').withConverter(userConverter)
    );
  }

  private userRef(uid: string) {
    return runInInjectionContext(this.injector, () =>
      doc(this.db, 'users', uid).withConverter(userConverter)
    );
  }

  getUser$(uid: string): Observable<IUserDados | null> {
    return runInInjectionContext(this.injector, () => docData(this.userRef(uid))).pipe(
      map(v => (v ?? null) as IUserDados | null),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  getUserOnce$(uid: string): Observable<IUserDados | null> {
    return from(runInInjectionContext(this.injector, () => getDoc(this.userRef(uid)))).pipe(
      map(snap => (snap.exists() ? snap.data()! : null)),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    try {
      const snap = await runInInjectionContext(this.injector, () =>
        getDocFromServer(doc(this.db, 'users', uid))
      );
      return snap.exists();
    } catch (e) {
      this.firestoreError.handleFirestoreError(e);
      return true; // conservador
    }
  }

  watchUserDocDeleted$(uid: string): Observable<boolean> {
    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', uid));
    return runInInjectionContext(this.injector, () => docSnapshots(ref)).pipe(
      map(snap => !snap.exists()),
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }

  getUsersByUidsOnce$(uids: string[]): Observable<IUserDados[]> {
    const ids = Array.from(new Set((uids ?? []).filter(Boolean)));
    if (!ids.length) return of([]);

    const col = this.usersCol();
    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) groups.push(ids.slice(i, i + 10));

    return from((async () => {
      const all: IUserDados[] = [];
      for (const g of groups) {
        const snap = await getDocs(query(col, where(documentId(), 'in', g)));
        snap.forEach(d => all.push(d.data()));
      }
      return all;
    })()).pipe(
      catchError(err => this.firestoreError.handleFirestoreError(err))
    );
  }
}
