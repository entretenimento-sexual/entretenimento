// src\app\core\guards\auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/autentication/auth.service';
import { FirestoreService } from '../services/data-handling/firestore.service';
import { map, switchMap, take } from 'rxjs/operators';
import { doc, getDoc } from 'firebase/firestore';
import { of } from 'rxjs';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export const authRedirectGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const firestoreService = inject(FirestoreService);
  const router = inject(Router);
  const auth = getAuth(); // Obtém a instância de autenticação do Firebase

  return new Promise<boolean>((resolve) => {
    onAuthStateChanged(auth, (user) => {
      console.log('Verificando se o usuário está autenticado (onAuthStateChanged):', user);
      if (user) {
        console.log('Usuário autenticado, verificando campos obrigatórios... UID:', user.uid);

        // Busca o documento do usuário no Firestore
        const userRef = doc(firestoreService.db, 'users', user.uid);
        getDoc(userRef).then((userSnapshot) => {
          if (userSnapshot.exists()) {
            const userData = userSnapshot.data();
            console.log('Dados do usuário recuperados:', userData);

            const hasRequiredFields = !!userData['municipio'] && !!userData['gender'];
            console.log('Campos obrigatórios preenchidos:', hasRequiredFields);

            if (hasRequiredFields) {
              console.log('Redirecionando para o dashboard...');
              router.navigate(['/dashboard/principal']);
              resolve(false); // Bloqueia o acesso à página de login
            } else {
              console.log('Campos obrigatórios não preenchidos. Permite o acesso ao login.');
              resolve(true); // Permite o acesso ao login
            }
          } else {
            console.log('Snapshot do usuário não encontrado no Firestore.');
            resolve(true); // Permite o acesso ao login
          }
        }).catch(error => {
          console.error('Erro ao buscar dados do usuário no Firestore:', error);
          resolve(true); // Em caso de erro, permite o acesso ao login
        });
      } else {
        console.log('Usuário não autenticado. Permite o acesso ao login.');
        resolve(true); // Usuário não está logado, permite o acesso ao login
      }
    });
  });
};
