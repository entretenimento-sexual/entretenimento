// src/app/store/effects/effects.user/online-users-profile-hydration.service.ts
// =============================================================================
// SERVIÇO: ONLINE USERS PROFILE HYDRATION
// =============================================================================
//
// Responsabilidade:
// - normalizar public_profiles para uso no modo Online;
// - juntar dados públicos persistentes com dados efêmeros de presence;
// - preservar métricas públicas de mídia usadas pelo ranking canônico;
// - impedir que sanitizeUserForStore remova campos públicos necessários ao card.
//
// Regra de arquitetura:
// - este service NÃO consulta Firestore;
// - este service NÃO despacha action NgRx;
// - este service NÃO calcula score;
// - este service NÃO ordena perfis;
// - o ranking continua no DiscoveryCardEnrichmentService.
//
// Segurança:
// - não inclui e-mail;
// - não inclui telefone;
// - não inclui dados privados de users/{uid};
// - só materializa dados públicos usados no card/ranking.

import { Injectable } from '@angular/core';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';

@Injectable({ providedIn: 'root' })
export class OnlineUsersProfileHydrationService {
  /**
   * Normaliza o documento público vindo de public_profiles para o formato que o
   * UserCardComponent e o pipeline canônico de discovery entendem.
   */
  normalizePublicProfileForOnline(
    rawProfile: IUserDados | null | undefined
  ): IUserDados | null {
    if (!rawProfile) {
      return null;
    }

    const raw = rawProfile as any;

    const uid = this.firstText(raw, ['uid']);
    const nickname = this.firstText(raw, ['nickname']);

    if (!uid || !nickname) {
      return null;
    }

    const latitude = this.toOptionalNumber(
      this.firstValue(raw, ['latitude', 'lat'])
    );

    const longitude = this.toOptionalNumber(
      this.firstValue(raw, ['longitude', 'lng', 'lon'])
    );

    const metrics = this.readPublicMediaMetrics(raw);

    const normalized = {
      ...rawProfile,

      uid,
      nickname,

      nicknameNormalized:
        this.firstText(raw, ['nicknameNormalized']) ??
        nickname.trim().toLowerCase(),

      photoURL: this.firstText(raw, [
        'photoURL',
        'photoUrl',
        'avatarUrl',
        'avatarURL',
      ]),

      gender: this.firstText(raw, [
        'gender',
        'genero',
      ]),

      orientation: this.firstText(raw, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]),

      partner1Orientation: this.firstText(raw, [
        'partner1Orientation',
        'orientation1',
        'orientacaoParceiro1',
      ]),

      partner2Orientation: this.firstText(raw, [
        'partner2Orientation',
        'orientation2',
        'orientacaoParceiro2',
      ]),

      municipio: this.firstText(raw, [
        'municipio',
        'cidade',
        'city',
      ]),

      estado: this.firstText(raw, [
        'estado',
        'uf',
        'state',
      ]),

      role:
        this.firstText(raw, ['role']) ??
        'free',

      latitude,
      longitude,

      geohash: this.firstText(raw, ['geohash']),

      ...metrics,

      createdAt: this.firstValue(raw, ['createdAt']),
      updatedAt: this.firstValue(raw, ['updatedAt']),
    } as IUserDados;

    /**
     * Sanitiza e reimpõe os campos públicos normalizados.
     *
     * Isso evita regressão caso o serializer não preserve algum alias relevante
     * para o card/ranking, sem permitir que dados privados entrem no objeto final.
     */
    const safe = sanitizeUserForStore(normalized) as IUserDados | null;

    if (!safe?.uid) {
      return null;
    }

    return {
      ...safe,

      uid,
      nickname,

      nicknameNormalized: (normalized as any).nicknameNormalized,

      photoURL: (normalized as any).photoURL,

      gender: (normalized as any).gender,
      orientation: (normalized as any).orientation,
      partner1Orientation: (normalized as any).partner1Orientation,
      partner2Orientation: (normalized as any).partner2Orientation,

      municipio: (normalized as any).municipio,
      estado: (normalized as any).estado,

      role: (normalized as any).role,

      latitude: (normalized as any).latitude,
      longitude: (normalized as any).longitude,
      geohash: (normalized as any).geohash,

      ...this.serializePublicMediaMetrics(normalized),

      createdAt: this.toSerializableStoreValue((normalized as any).createdAt),
      updatedAt: this.toSerializableStoreValue((normalized as any).updatedAt),
    } as IUserDados;
  }

  /**
   * Junta public_profiles + presence.
   *
   * Regra:
   * - public_profiles é a base persistente do card;
   * - presence só entra com status/timestamps efêmeros;
   * - presence nunca deve apagar dados públicos.
   */
  mergePresenceIntoPublicProfile(
    profile: IUserDados,
    presence: IUserDados | null | undefined
  ): IUserDados {
    const anyProfile = profile as any;
    const anyPresence = presence as any;

    const merged = {
      ...profile,

      uid: anyProfile.uid,

      /**
       * Não inferimos online por lastSeen.
       * Online vem explicitamente de presence.isOnline.
       */
      isOnline: anyPresence?.isOnline === true,

      lastSeen:
        anyPresence?.lastSeen ??
        anyProfile.lastSeen ??
        null,

      lastOnlineAt:
        anyPresence?.lastOnlineAt ??
        anyProfile.lastOnlineAt ??
        null,

      lastOfflineAt:
        anyPresence?.lastOfflineAt ??
        anyProfile.lastOfflineAt ??
        null,

      lastStateChangeAt:
        anyPresence?.lastStateChangeAt ??
        anyProfile.lastStateChangeAt ??
        null,

      presenceState:
        anyPresence?.presenceState ??
        anyProfile.presenceState ??
        null,

      presenceSessionId:
        anyPresence?.presenceSessionId ??
        anyProfile.presenceSessionId ??
        null,
    } as IUserDados;

    const safe = sanitizeUserForStore(merged) as IUserDados | null;

    return {
      ...(safe ?? merged),

      uid: anyProfile.uid,
      nickname: anyProfile.nickname,
      nicknameNormalized: anyProfile.nicknameNormalized,

      photoURL: anyProfile.photoURL,

      gender: anyProfile.gender,
      orientation: anyProfile.orientation,
      partner1Orientation: anyProfile.partner1Orientation,
      partner2Orientation: anyProfile.partner2Orientation,

      municipio: anyProfile.municipio,
      estado: anyProfile.estado,

      role: anyProfile.role,

      latitude: anyProfile.latitude,
      longitude: anyProfile.longitude,
      geohash: anyProfile.geohash,

      ...this.serializePublicMediaMetrics(anyProfile),

      createdAt: this.toSerializableStoreValue(anyProfile.createdAt),
      updatedAt: this.toSerializableStoreValue(anyProfile.updatedAt),

      isOnline: anyPresence?.isOnline === true,

      lastSeen: this.toSerializableStoreValue(
        anyPresence?.lastSeen ??
          anyProfile.lastSeen ??
          null
      ),

      lastOnlineAt: this.toSerializableStoreValue(
        anyPresence?.lastOnlineAt ??
          anyProfile.lastOnlineAt ??
          null
      ),

      lastOfflineAt: this.toSerializableStoreValue(
        anyPresence?.lastOfflineAt ??
          anyProfile.lastOfflineAt ??
          null
      ),

      lastStateChangeAt: this.toSerializableStoreValue(
        anyPresence?.lastStateChangeAt ??
          anyProfile.lastStateChangeAt ??
          null
      ),

      presenceState:
        anyPresence?.presenceState ??
        anyProfile.presenceState ??
        null,

      presenceSessionId:
        anyPresence?.presenceSessionId ??
        anyProfile.presenceSessionId ??
        null,
    } as IUserDados;
  }

  /**
   * Lê as métricas públicas canônicas e seus aliases legados.
   *
   * Fonte real:
   * - public_profiles/{uid}
   *
   * Consumidor:
   * - DiscoveryCardEnrichmentService
   */
  private readPublicMediaMetrics(source: any): Record<string, unknown> {
    const mediaCount = this.firstNumber(source, ['mediaCount', 'publicMediaCount']);
    const photosCount = this.firstNumber(source, ['photosCount', 'publicPhotosCount']);
    const videosCount = this.firstNumber(source, ['videosCount', 'publicVideosCount']);
    const viewsCount = this.firstNumber(source, [
      'viewsCount',
      'profileViewsCount',
      'profileViews',
    ]);
    const likesCount = this.firstNumber(source, [
      'likesCount',
      'publicLikesCount',
      'reactionsCount',
    ]);
    const reactionsCount = this.firstNumber(source, ['reactionsCount']) ?? likesCount;
    const uniqueViewersCount = this.firstNumber(source, ['uniqueViewersCount']);
    const viewScore = this.firstNumber(source, ['viewScore']);
    const engagementScore = this.firstNumber(source, ['engagementScore']);
    const profileCompletenessScore = this.firstNumber(source, [
      'profileCompletenessScore',
    ]);

    return {
      mediaCount,
      publicMediaCount: mediaCount,
      photosCount,
      publicPhotosCount: photosCount,
      videosCount,
      publicVideosCount: videosCount,
      viewsCount,
      profileViewsCount: viewsCount,
      profileViews: viewsCount,
      likesCount,
      publicLikesCount: likesCount,
      reactionsCount,
      uniqueViewersCount,
      viewScore,
      engagementScore,
      profileCompletenessScore,
      mediaMetricsUpdatedAt: this.firstValue(source, ['mediaMetricsUpdatedAt']),
    };
  }

  /**
   * Garante que datas/Timestamps não entrem crus no store.
   */
  private serializePublicMediaMetrics(source: any): Record<string, unknown> {
    const metrics = this.readPublicMediaMetrics(source);

    return {
      ...metrics,
      mediaMetricsUpdatedAt: this.toSerializableStoreValue(
        metrics['mediaMetricsUpdatedAt']
      ),
    };
  }

  private firstText(source: any, keys: readonly string[]): string | null {
    for (const key of keys) {
      const value = this.toCleanText(source?.[key]);

      if (value) {
        return value;
      }
    }

    return null;
  }

  private firstValue<T = unknown>(
    source: any,
    keys: readonly string[]
  ): T | null {
    for (const key of keys) {
      const value = source?.[key];

      if (value !== undefined && value !== null) {
        return value as T;
      }
    }

    return null;
  }

  private firstNumber(source: any, keys: readonly string[]): number | null {
    return this.toOptionalNumber(this.firstValue(source, keys));
  }

  private toCleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();

    return text.length ? text : null;
  }

  private toOptionalNumber(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(n) ? n : null;
  }

  private toSerializableStoreValue(value: unknown): unknown {
    if (value === undefined || value === null) {
      return null;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const maybeTimestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    } | null | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      const millis = maybeTimestamp.toMillis();

      return Number.isFinite(millis) ? millis : null;
    }

    if (typeof maybeTimestamp?.toDate === 'function') {
      const millis = maybeTimestamp.toDate().getTime();

      return Number.isFinite(millis) ? millis : null;
    }

    if (
      typeof maybeTimestamp?.seconds === 'number' &&
      Number.isFinite(maybeTimestamp.seconds)
    ) {
      return maybeTimestamp.seconds * 1000;
    }

    return null;
  }
} // Linha 461
