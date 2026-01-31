// src/app/core/debug/auth-debug.service.ts
// Não esquecer comentários e ferramentas de debug
import {
  Injectable, EnvironmentInjector, runInInjectionContext, inject, DestroyRef
} from '@angular/core';
import { Auth, authState, idToken } from '@angular/fire/auth';
import { Subscription, combineLatest, EMPTY, from, defer } from 'rxjs';
import {
  catchError, distinctUntilChanged, map, startWith, take, filter,
  shareReplay, auditTime, debounceTime
} from 'rxjs/operators';

// ⬇️ IMPORTA do SDK WEB (não do @angular/fire)
import { onIdTokenChanged, type Auth as FirebaseAuth } from 'firebase/auth';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import {
  selectAuthUid,
  selectAuthEmailVerified,
  selectAuthReady,
  selectIsAuthenticated,
} from 'src/app/store/selectors/selectors.user/auth.selectors';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const ts = () => new Date().toISOString().split('T')[1]!.replace('Z', '');

@Injectable({ providedIn: 'root' })
export class AuthDebugService {
  private env = inject(EnvironmentInjector);
  private store = inject(Store<AppState>);
  private authSession = inject(AuthSessionService);
  private globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly destroyRef = inject(DestroyRef);

  private subs = new Subscription();
  private started = false;

  // ✅ controla explicitamente o listener do SDK nativo
  private offIdTokenChanged?: () => void;

  private storageHandler?: (e: StorageEvent) => void;

  constructor(private readonly auth: Auth) {
    // ✅ Em debug service, NÃO registre listeners no constructor.
    // O ciclo correto é start()/stop() para evitar duplicidade e ruído em dev/HMR.

    this.destroyRef.onDestroy(() => {
      // segurança extra (HMR/Hot reload)
      this.stop();
    });
  }

  start() {
    if (this.started) return;
    this.started = true;

    // reinicia container
    this.subs = new Subscription();

    runInInjectionContext(this.env, () => {
      // 1) AngularFire authState (fonte do AngularFire)
      this.subs.add(
        authState(this.auth).pipe(
          map(u => (u ? ({
            uid: u.uid,
            email: u.email,
            verified: u.emailVerified,
            prov: u.providerData?.map(p => p?.providerId),
          }) : null)),
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

      // 1.1) AngularFire idToken stream (não é necessário chamar getIdToken(true))
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

      // 2) SDK nativo (uma única vez por start)
      this.offIdTokenChanged = onIdTokenChanged(
        this.auth as unknown as FirebaseAuth,
        (u) => console.log(`[AUTH][${ts()}] firebase.onIdTokenChanged(cb) →`, u ? { uid: u.uid } : null),
        (err) => {
          this.globalErrorHandler.handleError(
            err instanceof Error ? err : new Error('AuthDebugService: firebase.onIdTokenChanged error')
          );
        }
      );

      // 3) AuthSessionService uid$ (sua “fonte de verdade” do UID no app)
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

      // 4) NgRx (state.auth)
      const storeUid$ = this.store.select(selectAuthUid).pipe(distinctUntilChanged());
      const storeReady$ = this.store.select(selectAuthReady).pipe(distinctUntilChanged());
      const storeVerified$ = this.store.select(selectAuthEmailVerified).pipe(distinctUntilChanged());
      const storeAuthed$ = this.store.select(selectIsAuthenticated).pipe(distinctUntilChanged());

      this.subs.add(storeReady$.subscribe(ready => console.log(`[AUTH][${ts()}] ngrx.auth.ready →`, ready)));
      this.subs.add(storeAuthed$.subscribe(isAuth => console.log(`[AUTH][${ts()}] ngrx.auth.isAuthenticated →`, isAuth)));
      this.subs.add(storeUid$.subscribe(uid => console.log(`[AUTH][${ts()}] ngrx.auth.userId(uid) →`, uid)));
      this.subs.add(storeVerified$.subscribe(v => console.log(`[AUTH][${ts()}] ngrx.auth.emailVerified →`, v)));

      // 5) Cross-check (Firebase/AuthSession vs NgRx)
      const sessionReady$ = defer(() => from(this.authSession.whenReady())).pipe(
        map(() => true),
        startWith(false),
        shareReplay({ bufferSize: 1, refCount: true })
      );

      const cross$ = combineLatest({
        sessionReady: sessionReady$,
        sessionUid: this.authSession.uid$.pipe(distinctUntilChanged()),
        ngrxReady: storeReady$,
        ngrxAuthed: storeAuthed$.pipe(auditTime(0)),
        ngrxUid: storeUid$.pipe(auditTime(0)),
      }).pipe(
        filter(({ sessionReady, ngrxReady }) => sessionReady === true && ngrxReady === true),
        debounceTime(25),
        map(({ sessionUid, ngrxUid, ngrxAuthed }) => ({
          sessionUid: sessionUid ?? null,
          ngrxUid: ngrxUid ?? null,
          ngrxAuthed,
        })),
        filter(({ sessionUid, ngrxAuthed, ngrxUid }) => {
          const expectedTransient = !!sessionUid && !ngrxAuthed && !ngrxUid;
          return !expectedTransient;
        }),
        distinctUntilChanged((a, b) =>
          a.sessionUid === b.sessionUid && a.ngrxUid === b.ngrxUid && a.ngrxAuthed === b.ngrxAuthed
        ),
        catchError(err => {
          this.globalErrorHandler.handleError(
            err instanceof Error ? err : new Error('AuthDebugService: falha no cross-check uid')
          );
          return EMPTY;
        })
      );

      this.subs.add(
        cross$.subscribe(({ sessionUid, ngrxUid, ngrxAuthed }) => {
          if (sessionUid !== ngrxUid) {
            console.log(`[AUTH][${ts()}] UID MISMATCH (session vs ngrx)`, { sessionUid, ngrxUid, ngrxAuthed });
          }
        })
      );

      // 6) Cross-tab/localStorage
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
    if (!this.started) return;

    // remove storage listener
    if (this.storageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageHandler);
    }
    this.storageHandler = undefined;

    // encerra subs rx
    this.subs.unsubscribe();
    this.subs = new Subscription();

    // encerra listener nativo (SDK)
    try { this.offIdTokenChanged?.(); } catch { }
    this.offIdTokenChanged = undefined;

    this.started = false;
  }
}
