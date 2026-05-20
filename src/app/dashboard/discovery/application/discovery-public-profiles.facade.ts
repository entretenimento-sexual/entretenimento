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
// - aplicar filtros nativos/sutis de elegibilidade pública;
// - calcular distância quando houver coordenadas;
// - calcular score/ranking em memória;
// - não exigir localização para o modo "Todos";
// - não depender de presença online para montar o feed geral.
//
// Regra de produto:
// - "Todos" NÃO significa todos os usuários brutos da plataforma;
// - "Todos" significa feed geral refinado de perfis públicos elegíveis;
// - online pode ser usado futuramente como bônus leve de ranking,
//   mas não deve ser fonte nem filtro obrigatório do modo "Todos".
//
// Supressão explícita desta revisão:
// - UserDiscoveryPresenceFacade;
// - compareDiscoverableProfilesStable;
// - vínculo direto do modo "Todos" com presence/online.
//
// Motivo:
// - "Todos" deve nascer de public_profiles;
// - "Online" deve ser um recorte próprio de presença;
// - ranking/score é a camada correta para ordenar o feed geral.

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

import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { extractValidGeoCoordinates } from 'src/app/core/services/geolocation/utils/geolocation-coordinate.utils';

import {
  canExposePublicDiscoveryProfile,
  getPublicDiscoveryProfileRejectionReason,
} from 'src/app/core/utils/discovery/discovery-profile-visibility.utils';

import {
  scoreDiscoveryProfiles,
} from 'src/app/core/utils/discovery/discovery-profile-score.utils';

import { PublicProfileCard } from '../models/public-profile-card.model';

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

  private readonly distanceCalculation = inject(DistanceCalculationService);
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
      const viewerCoords = extractValidGeoCoordinates(currentUser);

      const mappedProfiles = (users ?? []).map((user) => {
        const profile = this.toPublicProfileCard(user);

        return {
          user,
          profile,
          uid: this.toNullableText(user?.uid),
          nickname: this.toNullableText(user?.nickname),
          rejectionReason: getPublicDiscoveryProfileRejectionReason(
            profile as any
          ),
        };
      });

      const eligibleProfiles = mappedProfiles
        .filter((item) => !!item.profile)
        .filter((item) => item.profile!.uid !== currentUid)
        .filter((item) =>
          canExposePublicDiscoveryProfile(item.profile as any)
        )
        .map((item) => item.profile as PublicProfileCard)
        .map((profile) => this.withPresence(profile, onlinePresenceByUid))
        .map((profile) => this.withDistance(profile, viewerCoords));

      const scoredProfiles = scoreDiscoveryProfiles(eligibleProfiles, {
        mode: 'all',
        viewerUid: currentUid,
        viewerEstado: currentUser?.estado ?? null,
        viewerMunicipio: currentUser?.municipio ?? null,
      }).sort((a, b) => {
        if (b.score.total !== a.score.total) {
          return b.score.total - a.score.total;
        }

        return String(a.profile.nickname || '').localeCompare(
          String(b.profile.nickname || ''),
          'pt-BR',
          { sensitivity: 'base' }
        );
      });

      const profiles = scoredProfiles.map((item) => item.profile);

      this.logDiscovery('public profiles scored result', {
        currentUid,
        sourceTotal: users?.length ?? 0,
        onlinePresenceTotal: onlinePresenceByUid.size,
        viewerCoords,
        profilesTotal: profiles.length,
        onlineTotal: profiles.filter((profile) => profile.isOnline === true).length,
        withDistanceTotal: profiles.filter(
          (profile) => typeof profile.distanciaKm === 'number'
        ).length,
        rejected: mappedProfiles
          .filter((item) => {
            if (!item.profile) return true;
            if (item.profile.uid === currentUid) return true;

            return !canExposePublicDiscoveryProfile(item.profile as any);
          })
          .map((item) => ({
            uid: item.uid,
            nickname: item.nickname,
            reason: !item.profile
              ? 'invalid_public_profile'
              : item.profile.uid === currentUid
                ? 'current_user'
                : item.rejectionReason,
          })),
        scores: scoredProfiles.map((item) => ({
          uid: item.profile.uid,
          nickname: item.profile.nickname,
          isOnline: item.profile.isOnline,
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

  private toPublicProfileCard(user: IUserDados): PublicProfileCard | null {
    const uid = this.toNullableText(user?.uid);

    if (!uid) {
      return null;
    }

    const nickname = this.toNullableText(user?.nickname);

    if (!nickname) {
      return null;
    }

    const coords = extractValidGeoCoordinates(user);
    const anyUser = user as any;

    return {
      uid,
      nickname,

      nicknameNormalized: this.toNullableText(anyUser.nicknameNormalized),

      photoURL:
        this.toNullableText(user.photoURL) ||
        this.toNullableText(anyUser.photoUrl) ||
        this.toNullableText(anyUser.avatarUrl),

      gender: this.toNullableText(user.gender),

      orientation:
        this.toNullableText(anyUser.orientation) ||
        this.toNullableText(anyUser.sexualOrientation) ||
        this.toNullableText(anyUser.orientacao) ||
        this.toNullableText(anyUser.orientacaoSexual),

      estado: this.toNullableText(user.estado),
      municipio: this.toNullableText(user.municipio),

      role: this.toNullableText(user.role),

      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      geohash: this.toNullableText(anyUser.geohash),

      /**
       * No modo "Todos", isOnline não deve conduzir a composição do feed.
       * Mantemos false por padrão enquanto não houver enriquecimento opcional
       * desacoplado da fonte principal.
       */
      isOnline: false,

      updatedAt: anyUser.updatedAt,
      createdAt: anyUser.createdAt,
    };
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

private withPresence(
  profile: PublicProfileCard,
  onlinePresenceByUid: Map<string, IUserDados>
): PublicProfileCard {
  const presence = onlinePresenceByUid.get(profile.uid);

  if (!presence) {
    return {
      ...profile,
      isOnline: false,
      lastSeen: profile.lastSeen ?? null,
    };
  }

  const anyPresence = presence as any;

  return {
    ...profile,
    isOnline: true,
    lastSeen: anyPresence.lastSeen ?? profile.lastSeen ?? null,
    lastOnlineAt: anyPresence.lastOnlineAt ?? profile.lastOnlineAt ?? null,
    lastOfflineAt: anyPresence.lastOfflineAt ?? profile.lastOfflineAt ?? null,
  };
}

  private withDistance(
    profile: PublicProfileCard,
    viewerCoords: { latitude: number; longitude: number } | null
  ): PublicProfileCard {
    if (!viewerCoords) {
      return {
        ...profile,
        distanciaKm: null,
      };
    }

    const profileCoords = extractValidGeoCoordinates(profile);

    if (!profileCoords) {
      return {
        ...profile,
        distanciaKm: null,
      };
    }

    const distanciaKm = this.distanceCalculation.calculateDistanceInKm(
      viewerCoords.latitude,
      viewerCoords.longitude,
      profileCoords.latitude,
      profileCoords.longitude
    );

    return {
      ...profile,
      distanciaKm,
    };
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
}