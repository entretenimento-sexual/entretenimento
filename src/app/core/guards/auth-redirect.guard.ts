// src/app/core/guards/auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { FirestoreService } from '../services/data-handling/firestore.service';
import { doc, getDoc, DocumentData } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Observable, from, of } from 'rxjs';
import { switchMap, take, catchError } from 'rxjs/operators';

export const authRedirectGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const firestoreService = inject(FirestoreService);
  const router = inject(Router);
  const auth = getAuth();

  return new Observable<User | null>((subscriber) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('🔐 Verificando autenticação via authRedirectGuard:', user);
      subscriber.next(user);
      subscriber.complete();
      unsubscribe();
    });
  }).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        console.log('👤 Nenhum usuário autenticado. Acesso permitido à rota atual.');
        return of(true);
      }

      const db = firestoreService.getFirestoreInstance();
      const userRef = doc(db, 'users', user.uid);

      return from(getDoc(userRef)).pipe(
        switchMap((userSnapshot) => {
          if (!userSnapshot.exists()) {
            console.log(`⚠️ Usuário autenticado (${user.uid}), mas não encontrado no Firestore.`);
            return of(true);
          }

          const userData = userSnapshot.data() as DocumentData;

          const profileIsComplete = userData?.['profileCompleted'] === true;

          if (profileIsComplete) {
            console.log('✅ Perfil completo. Redirecionando para dashboard...');
            return of(router.createUrlTree(['/dashboard/principal']));
          } else {
            console.log('⚠️ Perfil incompleto. Permite acesso para finalizar cadastro.');
            return of(true);
          }
        }),
        catchError((firestoreError) => {
          console.log('❌ Erro ao consultar dados no Firestore:', firestoreError);
          return of(true);
        })
      );
    }),
    catchError((listenerError) => {
      console.log('❌ Erro ao configurar listener de autenticação:', listenerError);
      return of(true);
    })
  );
};
