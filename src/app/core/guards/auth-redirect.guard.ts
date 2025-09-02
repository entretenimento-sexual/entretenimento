// src/app/core/guards/auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';

export const authRedirectGuard: CanActivateFn = (): import('rxjs').Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const afAuth = inject(AngularFireAuth);
  const users = inject(FirestoreUserQueryService);

  return afAuth.authState.pipe(
    take(1),
    switchMap(user => {
      // Não logado → deixa entrar (login/registro/etc.)
      if (!user) {
        console.log('👤 Nenhum usuário autenticado. Acesso permitido à rota atual.');
        return of(true);
      }

      // Logado → verifica perfil no Firestore
      return users.getUser(user.uid).pipe(
        take(1),
        map(u => {
          const complete = u?.profileCompleted === true; // garanta que IUserDados tenha profileCompleted?: boolean
          if (complete) {
            console.log('✅ Perfil completo. Redirecionando para dashboard...');
            return router.createUrlTree(['/dashboard/principal']);
          }
          console.log('⚠️ Perfil incompleto. Permite acesso para finalizar cadastro.');
          return true;
        }),
        catchError(err => {
          console.log('❌ Erro ao consultar dados no Firestore:', err);
          return of(true); // não bloqueia em caso de erro
        })
      );
    }),
    catchError(err => {
      console.log('❌ Erro ao ler estado de autenticação:', err);
      return of(true);
    })
  );
};
