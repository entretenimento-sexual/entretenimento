// src/app/core/services/data-handling/queries/user-discovery-presence.facade.ts
// Não esqueça os comentários

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { QueryConstraint } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from './user-discovery.query.service';
import { UserPresenceQueryService } from './user-presence.query.service';

/**
 * =============================================================================
 * DISCOVERY + PRESENCE FACADE (Read composition)
 * - Junta resultado de discovery (public_profiles) com status online (presence).
 * - NÃO abre listener por usuário (evita N listeners).
 * - Reusa o listener único de presença (getOnlineUsers$) via shareReplay.
 * - Não inventa UID: os serviços internos já têm guard por sessão.
 *
 * Estratégia (plataforma grande):
 * - public_profiles: dados públicos e consultáveis por filtros
 * - presence: estado efêmero (online/lastSeen)
 * - UI recebe lista já “enriquecida” com isOnline/lastSeen quando disponível
 * =============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserDiscoveryPresenceFacade {
  /**
   * Listener único compartilhado:
   * - se não houver sessão, o próprio service retorna [] (guard)
   */
  private readonly onlineUsers$ = this.presence.getOnlineUsers$().pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly discovery: UserDiscoveryQueryService,
    private readonly presence: UserPresenceQueryService
  ) { }

  /**
   * API principal:
   * - faz discovery one-shot (cacheado)
   * - combina com stream de online (realtime)
   */
  searchUsersWithPresence$(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.discovery.searchUsers(constraints ?? []).pipe(
      switchMap((profiles) => {
        if (!profiles?.length) return of([] as IUserDados[]);

        return this.onlineUsers$.pipe(
          map((online) => this.mergePresence(profiles, online))
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
      switchMap((profiles) => {
        if (!profiles?.length) return of([] as IUserDados[]);
        return this.onlineUsers$.pipe(map((online) => this.mergePresence(profiles, online)));
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Lista geral (admin/dev) enriquecida com presença.
   */
  getAllUsersWithPresence$(): Observable<IUserDados[]> {
    return this.discovery.getAllUsers$().pipe(
      switchMap((profiles) => {
        if (!profiles?.length) return of([] as IUserDados[]);
        return this.onlineUsers$.pipe(map((online) => this.mergePresence(profiles, online)));
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
        // offline (seguro)
        return {
          ...p,
          isOnline: false,
          // lastSeen offline pode ficar null; UI pode tratar como "visto há algum tempo"
          lastSeen: p.lastSeen ?? null,
        } as IUserDados;
      }

      // online (enriquecido)
      return {
        ...p,
        isOnline: true,
        lastSeen: (pres as any)?.lastSeen ?? p.lastSeen ?? null,
        lastOnlineAt: (pres as any)?.lastOnlineAt ?? p.lastOnlineAt ?? null,
        lastOfflineAt: (pres as any)?.lastOfflineAt ?? p.lastOfflineAt ?? null,
        // opcional: se você usa presenceState na UI
        ...(typeof (pres as any)?.presenceState !== 'undefined'
          ? { presenceState: (pres as any).presenceState }
          : {}),
      } as IUserDados;
    });
  }
}  // 134 linhas 
