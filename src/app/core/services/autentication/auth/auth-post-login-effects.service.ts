// src/app/core/services/autentication/auth/auth-post-login-effects.service.ts
// =============================================================================
// AUTH POST LOGIN EFFECTS SERVICE
//
// Responsabilidade única:
// - Executar efeitos de "app-mode" logo após login/autenticação válida
// - Garantir seed do users/{uid}
// - Atualizar lastLogin
// - Iniciar geolocalização em modo best-effort
//
// Não faz:
// - Não decide quando deve rodar
// - Não observa rota
// - Não observa sessão
// - Não faz signOut
// - Não bloqueia app
//
// Observação arquitetural:
// - O AuthOrchestratorService continua decidindo SE e QUANDO este fluxo roda.
// - Este service apenas encapsula a execução dos side-effects pós-login.
// =============================================================================

import { Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import type { User } from 'firebase/auth';

import { FirestoreUserWriteService } from '../../data-handling/firestore-user-write.service';
import { GeolocationTrackingService } from '../../geolocation/geolocation-tracking.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthPostLoginEffectsService {
  private readonly debug = !environment.production;

  constructor(
    private readonly userWrite: FirestoreUserWriteService,
    private readonly geoloc: GeolocationTrackingService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthPostLoginEffects] ${message}`, extra ?? '');
  }

  /**
   * Executa o pipeline completo de efeitos pós-login.
   *
   * Ordem:
   * 1) garante seed do doc
   * 2) atualiza lastLogin
   * 3) tenta iniciar geolocalização sem quebrar o fluxo
   */
  run$(authUser: User): Observable<void> {
    this.dbg('run$() start', { uid: authUser.uid });

    return this.userWrite.ensureUserDoc$(authUser, {
      nickname: authUser.displayName ?? null,
    }).pipe(
      switchMap(() => this.userWrite.patchLastLogin$(authUser.uid)),
      switchMap(() => this.autoStartGeolocationBestEffort$(authUser.uid)),
      tap(() => this.dbg('run$() done', { uid: authUser.uid })),
      map(() => void 0),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'auth-post-login-effects.run',
          uid: authUser.uid,
        });
        return of(void 0);
      })
    );
  }

  /**
   * Geolocalização best-effort:
   * - falha não derruba o restante do fluxo
   */
  private autoStartGeolocationBestEffort$(uid: string): Observable<void> {
    return from(this.geoloc.autoStartTracking(uid)).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'auth-post-login-effects.geolocation',
          uid,
        });
        return of(void 0);
      })
    );
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    this.dbg('reportSilent()', context);

    try {
      const error = new Error('[AuthPostLoginEffects] internal error');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }
} // fim do auth-post-login-effects.service.ts // Linha 109
