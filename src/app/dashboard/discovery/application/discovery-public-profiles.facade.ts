// src/app/dashboard/discovery/application/discovery-public-profiles.facade.ts
// -----------------------------------------------------------------------------
// DiscoveryPublicProfilesFacade
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - carregar perfis públicos para o modo "Todos";
// - expor profiles$, loading$ e errorMessage$;
// - manter PublicProfilesListComponent apenas visual;
// - consumir public_profiles como fonte principal;
// - buscar presença online apenas como enriquecimento opcional;
// - delegar distância, elegibilidade, score e ordenação para
//   DiscoveryCardEnrichmentService.
//
// Regra de produto:
// - "Todos" NÃO significa todos os usuários brutos da plataforma;
// - "Todos" significa feed geral refinado de perfis públicos elegíveis;
// - online pode ser bônus de ranking/status, mas não é fonte obrigatória.
//
// Supressão explícita desta revisão:
// - toPublicProfileCard();
// - withPresence();
// - withDistance();
// - scoreDiscoveryProfiles() direto na facade;
// - canExposePublicDiscoveryProfile() direto na facade;
// - getPublicDiscoveryProfileRejectionReason() direto na facade.
//
// Motivo:
// - essas regras agora pertencem ao DiscoveryCardEnrichmentService;
// - isso prepara a mesma lógica para Online, Perto, Região, Recentes,
//   Bombando e Compatíveis.

import { Injectable, inject } from '@angular/core';

import {
  Observable,
  combineLatest,
  concat,
  of,
} from 'rxjs';

import {
  catchError,
  map,
  shareReplay,
  switchMap,
  startWith,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { PublicProfileCard } from '../models/public-profile-card.model';
import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';

interface DiscoveryPublicProfilesState {
  profiles: readonly PublicProfileCard[];
  loading: boolean;
  errorMessage: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class DiscoveryPublicProfilesFacade {
  private readonly accessControl = inject(AccessControlService);
  private readonly currentUserStore = inject(CurrentUserStoreService);

  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly presenceQuery = inject(UserPresenceQueryService);

  private readonly cardEnrichment = inject(DiscoveryCardEnrichmentService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  /**
   * Debug manual.
   *
   * Uso no console:
   * localStorage.setItem('debug.discovery', '1');
   * location.reload();
   */
  private readonly debugDiscovery =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('debug.discovery') === '1';

  readonly state$: Observable<DiscoveryPublicProfilesState> = combineLatest([
    this.accessControl.authUid$,
    this.accessControl.canRunApp$,
    this.currentUserStore.user$,
  ]).pipe(
    switchMap(([currentUid, canRunApp, currentUser]) => {
      const safeCurrentUid = this.toNullableText(currentUid);

      if (!safeCurrentUid || !canRunApp) {
        return of({
          profiles: [],
          loading: false,
          errorMessage: null,
        });
      }

      return concat(
        of({
          profiles: [],
          loading: true,
          errorMessage: null,
        }),
        this.loadPublicProfiles$(safeCurrentUid, currentUser ?? null)
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly profiles$ = this.state$.pipe(
    map((state) => state.profiles)
  );

  readonly loading$ = this.state$.pipe(
    map((state) => state.loading)
  );

  readonly errorMessage$ = this.state$.pipe(
    map((state) => state.errorMessage)
  );

  private loadPublicProfiles$(
    currentUid: string,
    currentUser: IUserDados | null
  ): Observable<DiscoveryPublicProfilesState> {
    return combineLatest([
      this.discoveryQuery.getAllUsers$(),
      this.getOnlinePresenceByUid$(),
    ]).pipe(
      map(([users, onlinePresenceByUid]) => {
        const result = this.cardEnrichment.buildCardsResult({
          profiles: users ?? [],
          currentUser,
          currentUid,
          mode: 'all',
          onlinePresenceByUid,
          applyVisibility: true,
        });

        const profiles = result.profiles;

        this.logDiscovery('public profiles enrichment result', {
          currentUid,
          sourceTotal: users?.length ?? 0,
          onlinePresenceTotal: onlinePresenceByUid.size,
          profilesTotal: profiles.length,
          onlineTotal: profiles.filter(
            (profile) => profile.isOnline === true
          ).length,
          withDistanceTotal: profiles.filter(
            (profile) => typeof profile.distanciaKm === 'number'
          ).length,
          rejected: result.rejected,
          scores: result.scores.map((item) => ({
            uid: item.uid,
            nickname: item.nickname,
            total: Number(item.score.total.toFixed(2)),
            quality: Number(item.score.quality.toFixed(2)),
            media: Number(item.score.media.toFixed(2)),
            distance: Number(item.score.distance.toFixed(2)),
            region: Number(item.score.region.toFixed(2)),
            recency: Number(item.score.recency.toFixed(2)),
            role: Number(item.score.role.toFixed(2)),
            online: Number(item.score.online.toFixed(2)),
            compatibility: Number(item.score.compatibility.toFixed(2)),
            engagement: Number(item.score.engagement.toFixed(2)),
          })),
          profiles: profiles.map((profile) => ({
            uid: profile.uid,
            nickname: profile.nickname,
            isOnline: profile.isOnline,
            distanciaKm: profile.distanciaKm,
            latitude: profile.latitude,
            longitude: profile.longitude,
            municipio: profile.municipio,
            estado: profile.estado,
            role: profile.role,
          })),
        });

        return {
          profiles,
          loading: false,
          errorMessage: null,
        };
      }),
      catchError((error: unknown) => {
        this.globalErrorHandler.handleError(this.toError(error));

        return of({
          profiles: [],
          loading: false,
          errorMessage: 'Não foi possível carregar os perfis agora.',
        });
      })
    );
  }

  private getOnlinePresenceByUid$(): Observable<Map<string, IUserDados>> {
    return this.presenceQuery.getOnlineUsers$().pipe(
      startWith([] as IUserDados[]),
      map((onlineUsers) => {
        const byUid = new Map<string, IUserDados>();

        for (const user of onlineUsers ?? []) {
          const uid = this.toNullableText(user?.uid);

          if (!uid) {
            continue;
          }

          byUid.set(uid, user);
        }

        return byUid;
      }),
      catchError((error: unknown) => {
        const err = this.toError(error);

        /**
         * Presença é enriquecimento opcional.
         * Se falhar, o feed "Todos" continua funcionando sem status online.
         */
        (err as any).silent = true;
        (err as any).skipUserNotification = true;
        (err as any).context =
          'DiscoveryPublicProfilesFacade.getOnlinePresenceByUid$';

        this.globalErrorHandler.handleError(err);

        return of(new Map<string, IUserDados>());
      })
    );
  }

  private logDiscovery(tag: string, payload?: unknown): void {
    if (!this.debugDiscovery) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[DiscoveryPublicProfilesFacade] ${tag}`, payload ?? '');
  }

  private toNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();

    return text.length ? text : null;
  }

  private toError(value: unknown): Error {
    if (value instanceof Error) {
      return value;
    }

    if (typeof value === 'string') {
      return new Error(value);
    }

    try {
      return new Error(JSON.stringify(value));
    } catch {
      return new Error('Erro desconhecido ao carregar perfis públicos.');
    }
  }
} // Linha final do arquivo, 280 linhas, 6.0.3, ES2022, Bundler