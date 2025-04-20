// src/app/core/guards/auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/autentication/auth.service';
import { FirestoreService } from '../services/data-handling/firestore.service';
import { doc, getDoc } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export const authRedirectGuard: CanActivateFn = () => {
  const firestoreService = inject(FirestoreService);
  const router = inject(Router);
  const auth = getAuth();

  return new Promise<boolean>((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      console.log('🔐 Verificando autenticação:', user);

      if (!user) {
        resolve(true); // Permite acesso ao login se não autenticado
        return;
      }

      try {
        const db = firestoreService.getFirestoreInstance();
        const userRef = doc(db, 'users', user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!userSnapshot.exists()) {
          console.warn('⚠️ Usuário autenticado, mas não encontrado no Firestore.');
          resolve(true);
          return;
        }

        const userData = userSnapshot.data();
        const profileIsComplete = userData['profileCompleted'] === true;

        if (profileIsComplete) {
          console.log('✅ Perfil completo. Redirecionando para o dashboard.');
          await router.navigate(['/dashboard/principal']);
          resolve(false); // Bloqueia acesso à rota atual
        } else {
          console.log('⚠️ Perfil incompleto. Permite acesso para finalizar cadastro.');
          resolve(true); // Permite acesso à rota atual
        }
      } catch (error) {
        console.error('❌ Erro ao verificar dados do usuário:', error);
        resolve(true); // Em caso de erro, não bloqueia acesso
      }
    });
  });
};
