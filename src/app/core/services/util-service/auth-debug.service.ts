// src/app/core/debug/auth-debug.service.ts
import { Injectable, EnvironmentInjector, runInInjectionContext, inject } from '@angular/core';
import { Auth, authState, idToken } from '@angular/fire/auth';
import { Subscription, combineLatest, EMPTY } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

// ⬇️ IMPORTA do SDK WEB (não do @angular/fire)
import { onIdTokenChanged, type Auth as FirebaseAuth } from 'firebase/auth';

// ✅ Store (NgRx) — para logar state.auth de forma clara
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectAuthUid,
  selectAuthEmailVerified,
  selectAuthReady,
  selectIsAuthenticated,
} from 'src/app/store/selectors/selectors.user/auth.selectors';

// ✅ Fonte da verdade do UID (se você estiver usando no app)
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

// ✅ Tratamento centralizado (best-effort)
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const ts = () => new Date().toISOString().split('T')[1]!.replace('Z', '');

@Injectable({ providedIn: 'root' })
export class AuthDebugService {
  private auth = inject(Auth);
  private env = inject(EnvironmentInjector);
  private store = inject(Store<AppState>);
  private authSession = inject(AuthSessionService);
  private globalErrorHandler = inject(GlobalErrorHandlerService);

  private subs = new Subscription();
  private started = false;
  private storageHandler?: (e: StorageEvent) => void;

  start() {
    if (this.started) return;
    this.started = true;

    // ✅ importante: se você parar e iniciar de novo, recria o container de subs
    this.subs = new Subscription();

    runInInjectionContext(this.env, () => {
      // 1) Firebase / AngularFire (deixe explícito que NÃO é NgRx)
      this.subs.add(
        authState(this.auth).pipe(
          map(u => (u ? ({
            uid: u.uid,
            email: u.email,
            verified: u.emailVerified,
            prov: u.providerData?.map(p => p?.providerId),
          }) : null)),
          // reduz ruído: só loga quando muda algo relevante
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          catchError(err => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('AuthDebugService: falha no angularfire.authState()')
            );
            return EMPTY;
          })
        ).subscribe(snapshot => {
          console.log(`[AUTH][${ts()}] angularfire.authState$ →`, snapshot);
        })
      );

      this.subs.add(
        idToken(this.auth).pipe(
          map(() => this.auth.currentUser?.uid ?? null),
          distinctUntilChanged(),
          catchError(err => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('AuthDebugService: falha no angularfire.idToken()')
            );
            return EMPTY;
          })
        ).subscribe(uid => {
          console.log(`[AUTH][${ts()}] angularfire.idToken$ changed →`, { uid });
        })
      );

      // 2) Callback nativo (SDK) — opcional, mas ótimo pra comparar eventos
      const off = onIdTokenChanged(
        this.auth as unknown as FirebaseAuth,
        (u) => console.log(`[AUTH][${ts()}] firebase.onIdTokenChanged(cb) →`, u ? { uid: u.uid } : null),
        (err) => console.warn(`[AUTH][${ts()}] firebase.onIdTokenChanged error`, err)
      );
      this.subs.add({ unsubscribe: off });

      // 3) AuthSessionService (se você já usa como fonte de UID no app)
      this.subs.add(
        this.authSession.uid$.pipe(
          distinctUntilChanged(),
          catchError(err => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('AuthDebugService: falha no authSession.uid$')
            );
            return EMPTY;
          })
        ).subscribe(uid => {
          console.log(`[AUTH][${ts()}] authSession.uid$ →`, { uid });
        })
      );

      // 4) NgRx — state.auth (isso sim é Store)
      const storeUid$ = this.store.select(selectAuthUid).pipe(distinctUntilChanged());
      const storeReady$ = this.store.select(selectAuthReady).pipe(distinctUntilChanged());
      const storeVerified$ = this.store.select(selectAuthEmailVerified).pipe(distinctUntilChanged());
      const storeAuthed$ = this.store.select(selectIsAuthenticated).pipe(distinctUntilChanged());

      this.subs.add(storeReady$.subscribe(ready => {
        console.log(`[AUTH][${ts()}] ngrx.auth.ready →`, ready);
      }));

      this.subs.add(storeAuthed$.subscribe(isAuth => {
        console.log(`[AUTH][${ts()}] ngrx.auth.isAuthenticated →`, isAuth);
      }));

      this.subs.add(storeUid$.subscribe(uid => {
        console.log(`[AUTH][${ts()}] ngrx.auth.userId(uid) →`, uid);
      }));

      this.subs.add(storeVerified$.subscribe(v => {
        console.log(`[AUTH][${ts()}] ngrx.auth.emailVerified →`, v);
      }));

      // 5) Cross-check: Firebase/AuthSession vs NgRx (alerta quando divergir)
      this.subs.add(
        combineLatest([this.authSession.uid$, storeUid$]).pipe(
          distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1]),
          catchError(err => {
            this.globalErrorHandler.handleError(
              err instanceof Error ? err : new Error('AuthDebugService: falha no cross-check uid')
            );
            return EMPTY;
          })
        ).subscribe(([sessionUid, ngrxUid]) => {
          if (sessionUid !== ngrxUid) {
            console.warn(`[AUTH][${ts()}] UID MISMATCH (session vs ngrx)`, { sessionUid, ngrxUid });
          }
        })
      );

      // 6) Cross-tab/localStorage (logout em outra aba) — proteja SSR
      if (typeof window !== 'undefined') {
        this.storageHandler = (e: StorageEvent) => {
          if (e.key && (e.key.includes('firebase') || e.key.includes('auth'))) {
            console.log(`[AUTH][${ts()}] storage event`, { key: e.key, newValue: !!e.newValue });
          }
        };
        window.addEventListener('storage', this.storageHandler);
      }
    });
  }

  stop() {
    if (this.storageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageHandler);
    }
    this.storageHandler = undefined;
    this.started = false;

    this.subs.unsubscribe();
    this.subs = new Subscription();
  }
}
