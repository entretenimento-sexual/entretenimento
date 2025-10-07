// src/app/core/debug/auth-debug.service.ts
import { Injectable, EnvironmentInjector, runInInjectionContext, inject } from '@angular/core';
import { Auth, authState, idToken } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

// ⬇️  IMPORTA do SDK WEB (não do @angular/fire)
import { onIdTokenChanged, type Auth as FirebaseAuth } from 'firebase/auth';

const ts = () => new Date().toISOString().split('T')[1]!.replace('Z', '');

@Injectable({ providedIn: 'root' })
export class AuthDebugService {
  private auth = inject(Auth);
  private env = inject(EnvironmentInjector);
  private subs = new Subscription();

  start() {
    runInInjectionContext(this.env, () => {
      // 1) Fluxo AngularFire
      this.subs.add(
        authState(this.auth).subscribe(u => {
          console.log(`[AUTH][${ts()}] authState →`,
            u ? {
              uid: u.uid, email: u.email, verified: u.emailVerified,
              prov: u.providerData?.map(p => p?.providerId)
            } : null);
        })
      );

      this.subs.add(
        idToken(this.auth).subscribe(() => {
          console.log(`[AUTH][${ts()}] idToken changed →`, { uid: this.auth.currentUser?.uid ?? null });
        })
      );

      // 2) ➕ OPCIONAL: callback nativo para depuração
      const off = onIdTokenChanged(
        this.auth as unknown as FirebaseAuth,                         // cast p/ tipo do SDK
        (u) => console.log(`[AUTH][${ts()}] onIdTokenChanged(cb) →`, u ? { uid: u.uid } : null),
        (err) => console.warn(`[AUTH][${ts()}] onIdTokenChanged error`, err)
      );

      // Permite cleanup com this.stop()
      this.subs.add({ unsubscribe: off });

      // 3) Cross-tab/localStorage (logout em outra aba)
      window.addEventListener('storage', (e) => {
        if (e.key && (e.key.includes('firebase') || e.key.includes('auth'))) {
          console.log(`[AUTH][${ts()}] storage event`, { key: e.key, newValue: !!e.newValue });
        }
      });
    });
  }

  stop() { this.subs.unsubscribe(); }
}
