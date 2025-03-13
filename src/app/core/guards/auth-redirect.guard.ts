// src\app\core\guards\auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/autentication/auth.service';
import { FirestoreService } from '../services/data-handling/firestore.service';
import { doc, getDoc } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export const authRedirectGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const firestoreService = inject(FirestoreService);
  const router = inject(Router);
  const auth = getAuth();

  return new Promise<boolean>((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      console.log('Verificando autenticação:', user);
      if (!user) {
        resolve(true); // Permite acesso ao login
        return;
      }

      console.log('Usuário autenticado, verificando dados obrigatórios...');
      const db = firestoreService.getFirestoreInstance();
      const userRef = doc(db, 'users', user.uid);
      try {
        const userSnapshot = await getDoc(userRef);
        if (!userSnapshot.exists()) {
          console.log('Usuário não encontrado no Firestore.');
          resolve(true);
          return;
        }

        const userData = userSnapshot.data();
        const hasRequiredFields = !!userData['municipio'] && !!userData['gender'];

        if (hasRequiredFields) {
          console.log('Redirecionando para o dashboard.');
          await router.navigate(['/dashboard/principal']);
          resolve(false);
        } else {
          console.log('Campos obrigatórios ausentes. Permite acesso ao login.');
          resolve(true);
        }
      } catch (error) {
        console.error('Erro ao buscar usuário:', error);
        resolve(true);
      }
    });
  });
};
