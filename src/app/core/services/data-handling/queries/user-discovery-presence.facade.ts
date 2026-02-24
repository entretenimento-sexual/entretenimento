// src/app/core/services/data-handling/queries/user-discovery-presence.facade.ts
// Não esqueça os comentários e ferramentas de debug
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { QueryConstraint } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from './user-discovery.query.service';
import { UserPresenceQueryService } from './user-presence.query.service';

// ✅ Gate canônico (política central)
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

// ✅ Erro centralizado (padrão do projeto)
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';

/**
 * =============================================================================
 * DISCOVERY + PRESENCE FACADE (Read composition)
 * - Junta resultado de discovery (public_profiles) com status online (presence).
 *
 * Correção “plataforma grande”:
 * - NÃO abre listener de presença se o produto NÃO permitir (gate canônico).
 * - Gate único: AccessControlService.canRunOnlineUsers$ (política/capacidades).
 *
 * Motivação:
 * - Evita query/list de /presence no fluxo /register e em usuários não verificados.
 * - Evita custo/ruído e reduz risco de UX confusa (ex.: tentar mostrar online antes do ok).
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserDiscoveryPresenceFacade {
  private readonly debug = !environment.production;
  private lastNotifyAt = 0;

  /**
   * Listener único compartilhado (agora GATED):
   * - gate=false -> emite [] e NÃO cria listener
   * - gate=true  -> assina getOnlineUsers$ (realtime)
   */
  private readonly onlineUsers$ = this.access.canRunOnlineUsers$.pipe(
    distinctUntilChanged(),
    tap((can) => this.dbg('gate(onlineUsers$) ->', { can })),

    switchMap((can) => {
      if (!can) return of([] as IUserDados[]);
      return this.presence.getOnlineUsers$();
    }),

    // Safety net: presença é best-effort. Se falhar, degrada para [].
    catchError((err) => {
      this.reportSilent(err, 'UserDiscoveryPresenceFacade.onlineUsers$');
      // opcional: UX leve (com throttle)
      this.notifyOnce('Falha ao obter status online. Exibindo lista sem presença.');
      return of([] as IUserDados[]);
    }),

    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly discovery: UserDiscoveryQueryService,
    private readonly presence: UserPresenceQueryService,

    // ✅ gate canônico
    private readonly access: AccessControlService,

    // ✅ erro central
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  /**
   * API principal:
   * - discovery one-shot (cacheado)
   * - combina com presença (realtime, gated)
   */
  searchUsersWithPresence$(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.discovery.searchUsers(constraints ?? []).pipe(
      switchMap((profiles: IUserDados[]) => {
        if (!profiles?.length) return of([] as IUserDados[]);
        return this.onlineUsers$.pipe(
          map((online: IUserDados[]) => this.mergePresence(profiles, online))
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Wrapper mantendo “semântica” do método clássico.
   */
  getProfilesByOrientationAndLocationWithPresence$(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.discovery.getProfilesByOrientationAndLocation(gender, orientation, municipio).pipe(
      switchMap((profiles: IUserDados[]) => {
        if (!profiles?.length) return of([] as IUserDados[]);
        return this.onlineUsers$.pipe(
          map((online: IUserDados[]) => this.mergePresence(profiles, online))
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Lista geral (admin/dev) enriquecida com presença.
   */
  getAllUsersWithPresence$(): Observable<IUserDados[]> {
    return this.discovery.getAllUsers$().pipe(
      switchMap((profiles: IUserDados[]) => {
        if (!profiles?.length) return of([] as IUserDados[]);
        return this.onlineUsers$.pipe(
          map((online: IUserDados[]) => this.mergePresence(profiles, online))
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // --------------------------------------------------------------------------
  // Merge rules (prioridades)
  // --------------------------------------------------------------------------

  /**
   * Regras do merge:
   * - Perfil público (public_profiles) é “verdade” para nickname/município/foto/etc.
   * - Presença só contribui com isOnline/lastSeen/presenceState/lastOnlineAt/lastOfflineAt.
   *
   * Nota:
   * - Quando gate=false, onlineUsers$ emite [] e todo mundo vira isOnline=false.
   */
  private mergePresence(profiles: IUserDados[], onlineList: IUserDados[]): IUserDados[] {
    const mapOnline = new Map<string, IUserDados>();
    for (const u of onlineList ?? []) {
      const id = (u?.uid ?? '').toString().trim();
      if (id) mapOnline.set(id, u);
    }

    return (profiles ?? []).map((p) => {
      const uid = (p?.uid ?? '').toString().trim();
      const pres = uid ? mapOnline.get(uid) : undefined;

      if (!pres) {
        return {
          ...p,
          isOnline: false,
          lastSeen: p.lastSeen ?? null,
        } as IUserDados;
      }

      return {
        ...p,
        isOnline: true,
        lastSeen: (pres as any)?.lastSeen ?? p.lastSeen ?? null,
        lastOnlineAt: (pres as any)?.lastOnlineAt ?? p.lastOnlineAt ?? null,
        lastOfflineAt: (pres as any)?.lastOfflineAt ?? p.lastOfflineAt ?? null,
        ...(typeof (pres as any)?.presenceState !== 'undefined'
          ? { presenceState: (pres as any).presenceState }
          : {}),
      } as IUserDados;
    });
  }

  // --------------------------------------------------------------------------
  // Debug + erro centralizado
  // --------------------------------------------------------------------------

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[UserDiscoveryPresenceFacade] ${msg}`, extra ?? '');
  }

  private reportSilent(err: unknown, context: string): void {
    try {
      const e = err instanceof Error ? err : new Error(context);
      (e as any).silent = true;
      (e as any).context = context;
      (e as any).original = err;
      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }

  private notifyOnce(msg: string): void {
    const now = Date.now();
    if (now - this.lastNotifyAt > 15_000) {
      this.lastNotifyAt = now;
      this.errorNotifier.showError(msg);
    }
  }
} // linha 201, fim do UserDiscoveryPresenceFacade
