// src/app/core/services/user-profile/user-social-links.service.ts
import { Injectable } from '@angular/core';
import { doc, setDoc, getDoc, deleteField } from 'firebase/firestore';
import { Observable, from, of, throwError } from 'rxjs';
import { switchMap, catchError, map } from 'rxjs/operators';
import { IUserSocialLinks } from '../../interfaces/interfaces-user-dados/iuser-social-links';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

@Injectable({
  providedIn: 'root'
})
export class UserSocialLinksService {
  constructor(
    private firestoreService: FirestoreService,
    private errorNotifier: ErrorNotificationService
  ) { }

  /** Retorna as redes sociais do usuário */
  getSocialLinks(uid: string): Observable<IUserSocialLinks | null> {
    const db = this.firestoreService.getFirestoreInstance();
    const docRef = doc(db, `users/${uid}/profileData/socialLinks`);
    // ^ Exemplo de doc aninhado: "users/{uid}/profileData/socialLinks"
    //   Você pode preferir "users/{uid}/socialLinks" ou outra estrutura.

    return from(getDoc(docRef)).pipe(
      map(docSnap => {
        if (docSnap.exists()) {
          return docSnap.data() as IUserSocialLinks;
        }
        return null;
      }),
      catchError(error => {
        this.errorNotifier.showError('Erro ao carregar redes sociais.');
        return throwError(() => error);
      })
    );
  }

  /** Salva ou atualiza as redes sociais do usuário */
  saveSocialLinks(uid: string, links: IUserSocialLinks): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const docRef = doc(db, `users/${uid}/profileData/socialLinks`);

    return from(setDoc(docRef, links, { merge: true })).pipe(
      catchError(error => {
        this.errorNotifier.showError('Erro ao salvar redes sociais.');
        return throwError(() => error);
      })
    );
  }

  /** Remove uma rede específica do documento (por exemplo, remover Instagram) */
  removeLink(uid: string, linkKey: keyof IUserSocialLinks): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const docRef = doc(db, `users/${uid}/profileData/socialLinks`);

    return from(setDoc(docRef, { [linkKey]: deleteField() }, { merge: true })).pipe(
      catchError(error => {
        this.errorNotifier.showError('Erro ao remover rede social.');
        return throwError(() => error);
      })
    );
  }
}
