// src/app/store/effects/effects.user/online-users.effects.ts
// =============================================================================
// EFEITOS: ONLINE USERS
//
// Objetivo:
// - Manter uma fonte única de "onlineUsers" no NgRx (listener realtime),
//   com gating robusto (auth.ready + uid + emailVerified + não estar no registro).
// - Evitar listeners cedo demais (boot), e evitar listeners no fluxo /register.
// - Preservar serializabilidade (runtimeChecks ON).
// - Debug útil: diferenciar “0 por gating” vs “0 por snapshot/cache”.
// =============================================================================

import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';

import { of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { AppState } from '../../states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { sanitizeUsersForStore } from 'src/app/store/utils/user-store.serializer';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

// ✅ sessão é fonte da verdade (AuthSessionSyncEffects → authSessionChanged)
import { authSessionChanged } from '../../actions/actions.user/auth.actions';

// ✅ selectors de auth
import {
  selectAuthUid,
  selectAuthReady,
  // ⚠️ Ajuste o nome se no seu projeto for diferente
  selectAuthEmailVerified,
} from '../../selectors/selectors.user/auth.selectors';

// ✅ actions “online users”
import {
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  setFilteredOnlineUsers,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setCurrentUser,
  clearCurrentUser,
  updateUserInState,
} from '../../actions/actions.user/user.actions';

// ✅ selectors de user
import { selectCurrentUser, selectOnlineUsers } from '../../selectors/selectors.user/user.selectors';

/* ============================================================================
  Helpers puros: manter estado/actions serializáveis (runtimeChecks ON)
============================================================================ */

type SerializableError = { message: string; code?: string };

const toSerializableError = (err: unknown, fallbackMsg: string): SerializableError => {
  const anyErr = err as any;

  const message =
    (typeof anyErr?.message === 'string' && anyErr.message) ||
    (typeof anyErr === 'string' && anyErr) ||
    fallbackMsg;

  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
  return code ? { message, code } : { message };
};

const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

/* ============================================================================
  Effects
============================================================================ */

@Injectable()
export class OnlineUsersEffects {
  private readonly debug = !environment.production;

  constructor(
    private readonly actions$: Actions,
    private readonly store: Store<AppState>,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly router: Router,
  ) { }

  // ===========================================================================
  // Gating helpers (alinha com sua regra "não iniciar listeners no registro")
  // ===========================================================================

  /** Mesmo regex que você usa no AuthOrchestrator (consistência de plataforma) */
  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  /** Log “curto e informativo” (evita spam; só em dev) */
  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[OnlineUsersEffects] ${msg}`, extra ?? '');
  }

  // ===========================================================================
  // 1) Sessão mudou => decide START/STOP do listener
  //
  // Regra:
  // - START apenas se:
  //   - uid existe
  //   - auth.ready true
  //   - emailVerified true
  //   - NÃO está em /register...
  // - STOP caso contrário
  // ===========================================================================

  syncListenerFromAuthSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(authSessionChanged),

      concatLatestFrom(() => [
        this.store.select(selectAuthReady),
        this.store.select(selectAuthUid),
        this.store.select(selectAuthEmailVerified),
      ]),

      map(([, ready, uid, emailVerified]) => {
        const url = this.router.url || '';
        const inReg = this.inRegistrationFlow(url);

        const canStart = !!uid && ready === true && emailVerified === true && !inReg;

        if (this.debug) {
          this.dbg('authSessionChanged → gate', { ready, uid: uid ?? null, emailVerified, url, canStart });
        }

        return canStart ? startOnlineUsersListener() : stopOnlineUsersListener();
      }),

      // evita dispatch duplicado quando condições não mudaram
      distinctUntilChanged((a, b) => a.type === b.type),

      tap((action) => {
        if (!this.debug) return;
        this.dbg(action.type.includes('START') ? 'authSessionChanged → START listener' : 'authSessionChanged → STOP listener');
      }),
    )
  );

  // ===========================================================================
  // 2) Listener realtime (fonte única de onlineUsers)
  //
  // Regras:
  // - Revalida gating ao receber startOnlineUsersListener
  //   (protege contra start disparado cedo demais por corrida).
  // - takeUntil(stopOnlineUsersListener) garante teardown.
  // - finalize() pra debug de “unsub real”.
  // ===========================================================================

  onlineUsersListener$ = createEffect(() =>
    this.actions$.pipe(
      ofType(startOnlineUsersListener),

      concatLatestFrom(() => [
        this.store.select(selectAuthReady),
        this.store.select(selectAuthUid),
        this.store.select(selectAuthEmailVerified),
      ]),

      switchMap(([, ready, uid, emailVerified]) => {
        const url = this.router.url || '';
        const inReg = this.inRegistrationFlow(url);

        // ✅ Gating “duplo”: mesmo se alguém disparar START, aqui a gente barra.
        if (!ready || !uid || emailVerified !== true || inReg) {
          if (this.debug) {
            this.dbg('realtime START ignorado (gating)', { ready, uid: uid ?? null, emailVerified, url, inReg });
          }

          // limpa estado de UI + para listener (idempotente)
          return of(
            loadOnlineUsersSuccess({ users: [] }),
            setFilteredOnlineUsers({ filteredUsers: [] }),
            stopOnlineUsersListener()
          );
        }

        this.dbg('realtime listener START', { uid });

        return this.firestoreQuery.getOnlineUsers$().pipe(
          // garante que só entra dado serializável (runtimeChecks)
          map((users) => sanitizeUsersForStore(users)),

          // ✅ Debug: diferenciar "0 por snapshot/cache/aguardando presença" de outros 0s
          tap((users) => {
            if (!this.debug) return;
            const n = users.length;
            if (n === 0) {
              this.dbg('realtime onlineUsers => 0 (primeiro snapshot/cache ou aguardando presença ser escrita)');
            } else {
              this.dbg('realtime onlineUsers =>', n);
            }
          }),

          map((users) => loadOnlineUsersSuccess({ users })),

          takeUntil(
            this.actions$.pipe(
              ofType(stopOnlineUsersListener),
              tap(() => this.dbg('realtime listener STOP (takeUntil)'))
            )
          ),

          finalize(() => {
            // ✅ confirma teardown (muito útil pra detectar múltiplos listeners)
            this.dbg('realtime listener FINALIZE (unsub)');
          }),

          catchError((err) => {
            // centraliza erro (com contexto)
            this.globalErrorHandler.handleError(
              err instanceof Error
                ? err
                : new Error(toSerializableError(err, 'Falha ao ouvir usuários online.').message)
            );

            return of(
              loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao ouvir usuários online.') }),
              stopOnlineUsersListener()
            );
          })
        );
      })
    )
  );

  // ===========================================================================
  // 3) Compat “once”
  //
  // Use quando você precisa de snapshot único (sem listener).
  // Mantém gating para NÃO chamar Firestore se:
  // - não ready
  // - sem uid
  // - email não verificado
  // - no registro
  // ===========================================================================

  loadOnlineUsersOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsers),

      concatLatestFrom(() => [
        this.store.select(selectAuthReady),
        this.store.select(selectAuthUid),
        this.store.select(selectAuthEmailVerified),
      ]),

      switchMap(([, ready, uid, emailVerified]) => {
        const url = this.router.url || '';
        const inReg = this.inRegistrationFlow(url);

        if (!ready || !uid || emailVerified !== true || inReg) {
          this.dbg('loadOnlineUsers (once) ignorado (gating)', { ready, uid: uid ?? null, emailVerified, url, inReg });
          return of(loadOnlineUsersSuccess({ users: [] }));
        }

        this.dbg('loadOnlineUsers (once) START', { uid });

        return this.firestoreQuery.getOnlineUsers().pipe(
          map((users) => sanitizeUsersForStore(users)),

          // ✅ mesma lógica de debug do realtime
          tap((users) => {
            if (!this.debug) return;
            const n = users.length;
            if (n === 0) this.dbg('once onlineUsers => 0 (snapshot vazio)');
            else this.dbg('once onlineUsers =>', n);
          }),

          map((users) => loadOnlineUsersSuccess({ users })),

          catchError((err) => {
            this.globalErrorHandler.handleError(
              err instanceof Error
                ? err
                : new Error(toSerializableError(err, 'Falha ao carregar usuários online.').message)
            );
            return of(loadOnlineUsersFailure({ error: toSerializableError(err, 'Falha ao carregar usuários online.') }));
          })
        );
      })
    )
  );

  // ===========================================================================
  // 4) Filtro por município (somente UI)
  //
  // - Recalcula quando onlineUsers muda OU quando usuário atual muda
  // - Nunca quebra serializabilidade (usa list local tipada)
  // ===========================================================================

  recomputeFilteredOnlineUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadOnlineUsersSuccess, setCurrentUser, clearCurrentUser, updateUserInState),

      concatLatestFrom(() => [
        this.store.select(selectOnlineUsers),
        this.store.select(selectCurrentUser),
      ]),

      map(([, onlineUsers, currentUser]) => {
        const municipio = norm(currentUser?.municipio);

        // sem referência de município => UI limpa (não é erro)
        if (!municipio) return setFilteredOnlineUsers({ filteredUsers: [] });

        const list: IUserDados[] = Array.isArray(onlineUsers) ? (onlineUsers as IUserDados[]) : [];

        const filteredUsers = list.filter((u: IUserDados) => norm(u?.municipio) === municipio);
        return setFilteredOnlineUsers({ filteredUsers });
      }),

      catchError((err) => {
        this.globalErrorHandler.handleError(
          err instanceof Error ? err : new Error('Falha ao filtrar usuários online por município.')
        );
        return of(setFilteredOnlineUsers({ filteredUsers: [] }));
      })
    )
  );

  // ===========================================================================
  // 5) Ao parar o listener (logout/stop), garante UI limpa.
  // ===========================================================================

  clearFilteredOnStop$ = createEffect(() =>
    this.actions$.pipe(
      ofType(stopOnlineUsersListener),
      tap(() => this.dbg('STOP recebido → limpando filteredUsers')),
      map(() => setFilteredOnlineUsers({ filteredUsers: [] }))
    )
  );
}//Linha 355

/*
o ideal é:

1 listener realtime por feature no NgRx (aqui: onlineUsersListener$)

componentes consumindo via selectors (evita 2 listeners em paralelo: component + effect)

Você já está bem próximo disso. Se você quiser, eu te passo o patch mínimo para o
OnlineUsersComponent consumir selectOnlineUsers sem quebrar sua lógica de distância/slider
mantendo seu fluxo reativo).

*/
