// src/app/dashboard/discovery/application/discovery-card-enrichment.service.ts
// -----------------------------------------------------------------------------
// DiscoveryCardEnrichmentService
// -----------------------------------------------------------------------------
// FONTE CANÔNICA DE RANKING DE DISCOVERY.
//
// Responsabilidade:
// - transformar perfis públicos em PublicProfileCard;
// - enriquecer presença, distância e compatibilidade;
// - aplicar elegibilidade/visibilidade;
// - chamar o motor puro de score;
// - ordenar os cards;
// - devolver um debug summary padronizado.
//
// Regra arquitetural:
// - componentes/facades NÃO devem ordenar discovery manualmente por isOnline,
//   role, mediaCount, updatedAt, viewsCount, likesCount ou compatibilityScore;
// - toda tela de discovery deve consumir buildCardsResult() ou buildCards();
// - o cálculo matemático puro continua em discovery-profile-score.utils.ts;
// - esta camada é a fonte única do pipeline completo de ranking de cards.
// -----------------------------------------------------------------------------

import { Injectable, inject, isDevMode } from '@angular/core';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';

import {
  SafeGeoCoordinates,
  extractValidGeoCoordinates,
} from 'src/app/core/services/geolocation/utils/geolocation-coordinate.utils';

import {
  getPublicDiscoveryProfileRejectionReason,
  PublicDiscoveryProfileRejectionReason,
} from 'src/app/core/utils/discovery/discovery-profile-visibility.utils';

import {
  scoreDiscoveryProfiles,
  DiscoveryScoreBreakdown,
} from 'src/app/core/utils/discovery/discovery-profile-score.utils';

import { compareDiscoverableProfilesStable } from 'src/app/core/utils/discovery/discovery-profile-sort.utils';

import {
  DiscoveryMode,
  DEFAULT_DISCOVERY_MODE,
  discoveryModeRequiresLocation,
  normalizeDiscoveryMode,
} from '../models/discovery-mode.model';

import { PublicProfileCard } from '../models/public-profile-card.model';
import {
  evaluateProfileCompatibility,
  ProfileCompatibilityResult,
} from 'src/app/core/utils/discovery/profile-compatibility.util';

export interface DiscoveryCardEnrichmentInput {
  profiles: readonly IUserDados[];
  currentUser: IUserDados | null;
  currentUid?: string | null;
  mode?: DiscoveryMode | null;
  capKm?: number | null;
  fallbackLocation?: SafeGeoCoordinates | null;
  onlinePresenceByUid?: Map<string, IUserDados> | null;
  applyVisibility?: boolean;
}

export interface DiscoveryCardRejectedItem {
  uid: string | null;
  nickname: string | null;
  reason:
    | PublicDiscoveryProfileRejectionReason
    | 'current_user'
    | 'outside_radius'
    | 'incompatible_profile';
}

export interface DiscoveryCardScoreDebug {
  uid: string;
  nickname: string | null;
  score: DiscoveryScoreBreakdown;
}

export interface DiscoveryCardDebugSummary {
  mode: DiscoveryMode;
  sourceTotal: number;
  candidateTotal: number;
  acceptedTotal: number;
  rejectedTotal: number;
  onlineTotal: number;
  withDistanceTotal: number;
  withMediaTotal: number;
  withVideoTotal: number;
  rejectedByReason: Partial<Record<DiscoveryCardRejectedItem['reason'], number>>;
  topScores: Array<{
    uid: string;
    nickname: string | null;
    total: number;
    quality: number;
    media: number;
    distance: number;
    region: number;
    recency: number;
    role: number;
    online: number;
    compatibility: number;
    engagement: number;
  }>;
}

export interface DiscoveryCardEnrichmentResult {
  profiles: PublicProfileCard[];
  rejected: DiscoveryCardRejectedItem[];
  scores: DiscoveryCardScoreDebug[];

  /**
   * Debug canônico para facades e devtools.
   * Evita cada tela remontar seu próprio resumo com regras diferentes.
   */
  debugSummary: DiscoveryCardDebugSummary;
}

@Injectable({
  providedIn: 'root',
})
export class DiscoveryCardEnrichmentService {
  private readonly distanceCalculation = inject(DistanceCalculationService);

  buildCards(input: DiscoveryCardEnrichmentInput): PublicProfileCard[] {
    return this.buildCardsResult(input).profiles;
  }

  buildCardsResult(input: DiscoveryCardEnrichmentInput): DiscoveryCardEnrichmentResult {
    const mode = normalizeDiscoveryMode(input.mode ?? DEFAULT_DISCOVERY_MODE);

    const currentUid =
      this.toNullableText(input.currentUid) ??
      this.toNullableText(input.currentUser?.uid);

    const viewerCoords = this.resolveViewerCoordinates(
      input.currentUser,
      input.fallbackLocation ?? null
    );

    const capKm = this.normalizeCapKm(input.capKm);
    const applyVisibility = input.applyVisibility !== false;

    const rejected: DiscoveryCardRejectedItem[] = [];

    const candidates = (input.profiles ?? [])
      .map((profile) => this.toPublicProfileCard(profile))
      .filter((profile): profile is PublicProfileCard => !!profile)
      .map((profile) => this.withPresence(profile, input.onlinePresenceByUid ?? null))
      .map((profile) => this.withDistance(profile, viewerCoords))
      .map((profile) => this.withCompatibility(profile, input.currentUser));

    const eligible = candidates.filter((profile) => {
      if (currentUid && profile.uid === currentUid) {
        rejected.push({
          uid: profile.uid,
          nickname: profile.nickname ?? null,
          reason: 'current_user',
        });

        return false;
      }

      if (mode === 'compatible' && this.isIncompatibleForCompatibleMode(profile)) {
        rejected.push({
          uid: profile.uid ?? null,
          nickname: profile.nickname ?? null,
          reason: 'incompatible_profile',
        });

        return false;
      }

      if (mode === 'all' && this.isClearIncompatibilityForAllMode(profile)) {
        rejected.push({
          uid: profile.uid ?? null,
          nickname: profile.nickname ?? null,
          reason: 'incompatible_profile',
        });

        return false;
      }

      if (applyVisibility) {
        const reason = getPublicDiscoveryProfileRejectionReason(profile as any, { mode });

        if (reason !== null) {
          rejected.push({
            uid: profile.uid ?? null,
            nickname: profile.nickname ?? null,
            reason,
          });

          return false;
        }
      }

      if (discoveryModeRequiresLocation(mode) && !this.isInsideRadius(profile, capKm)) {
        rejected.push({
          uid: profile.uid ?? null,
          nickname: profile.nickname ?? null,
          reason: 'outside_radius',
        });

        return false;
      }

      return true;
    });

    const scored = scoreDiscoveryProfiles(eligible, {
      mode,
      viewerUid: currentUid,
      viewerEstado: input.currentUser?.estado ?? null,
      viewerMunicipio: input.currentUser?.municipio ?? null,
      maxUsefulDistanceKm: capKm,
    }).sort((a, b) => {
      if (b.score.total !== a.score.total) {
        return b.score.total - a.score.total;
      }

      return compareDiscoverableProfilesStable(a.profile, b.profile);
    });

    const profiles = scored.map((item) => item.profile);
    const scores = scored.map((item) => ({
      uid: item.profile.uid,
      nickname: item.profile.nickname ?? null,
      score: item.score,
    }));

    const result: DiscoveryCardEnrichmentResult = {
      profiles,
      rejected,
      scores,
      debugSummary: this.buildDebugSummary({
        mode,
        sourceTotal: input.profiles?.length ?? 0,
        candidates,
        profiles,
        rejected,
        scores,
      }),
    };

    this.debugCompatibleMode(mode, candidates, result);

    return result;
  }

  private buildDebugSummary(input: {
    mode: DiscoveryMode;
    sourceTotal: number;
    candidates: readonly PublicProfileCard[];
    profiles: readonly PublicProfileCard[];
    rejected: readonly DiscoveryCardRejectedItem[];
    scores: readonly DiscoveryCardScoreDebug[];
  }): DiscoveryCardDebugSummary {
    const rejectedByReason: Partial<Record<DiscoveryCardRejectedItem['reason'], number>> = {};

    for (const item of input.rejected) {
      rejectedByReason[item.reason] = (rejectedByReason[item.reason] ?? 0) + 1;
    }

    return {
      mode: input.mode,
      sourceTotal: input.sourceTotal,
      candidateTotal: input.candidates.length,
      acceptedTotal: input.profiles.length,
      rejectedTotal: input.rejected.length,
      onlineTotal: input.profiles.filter((profile) => profile.isOnline === true).length,
      withDistanceTotal: input.profiles.filter(
        (profile) => typeof profile.distanciaKm === 'number'
      ).length,
      withMediaTotal: input.profiles.filter(
        (profile) => (profile.mediaCount ?? 0) > 0 || (profile.photosCount ?? 0) > 0
      ).length,
      withVideoTotal: input.profiles.filter(
        (profile) => (profile.videosCount ?? 0) > 0
      ).length,
      rejectedByReason,
      topScores: input.scores.slice(0, 20).map((item) => ({
        uid: item.uid,
        nickname: item.nickname,
        total: this.roundScore(item.score.total),
        quality: this.roundScore(item.score.quality),
        media: this.roundScore(item.score.media),
        distance: this.roundScore(item.score.distance),
        region: this.roundScore(item.score.region),
        recency: this.roundScore(item.score.recency),
        role: this.roundScore(item.score.role),
        online: this.roundScore(item.score.online),
        compatibility: this.roundScore(item.score.compatibility),
        engagement: this.roundScore(item.score.engagement),
      })),
    };
  }

  private resolveViewerCoordinates(
    currentUser: IUserDados | null,
    fallbackLocation: SafeGeoCoordinates | null
  ): SafeGeoCoordinates | null {
    const fromProfile = extractValidGeoCoordinates(currentUser);

    if (fromProfile) {
      return fromProfile;
    }

    return extractValidGeoCoordinates(fallbackLocation);
  }

  private withCompatibility(
    profile: PublicProfileCard,
    currentUser: IUserDados | null
  ): PublicProfileCard {
    const result: ProfileCompatibilityResult = evaluateProfileCompatibility(
      currentUser,
      profile
    );

    return {
      ...profile,
      compatibilityScore: result.score,
      compatibilityReason: result.reason,
    };
  }

  private isIncompatibleForCompatibleMode(profile: PublicProfileCard): boolean {
    return profile.compatibilityReady === false ||
      profile.compatibilityScore === 0 ||
      profile.compatibilityReason === 'viewer_data_missing' ||
      profile.compatibilityReason === 'candidate_data_missing';
  }

  private isClearIncompatibilityForAllMode(profile: PublicProfileCard): boolean {
    return profile.compatibilityScore === 0 && (
      profile.compatibilityReason === 'viewer_not_interested' ||
      profile.compatibilityReason === 'candidate_not_interested' ||
      profile.compatibilityReason === 'mutual_mismatch'
    );
  }

  private debugCompatibleMode(
    mode: DiscoveryMode,
    candidates: readonly PublicProfileCard[],
    result: DiscoveryCardEnrichmentResult
  ): void {
    if (!isDevMode() || mode !== 'compatible') {
      return;
    }

    const acceptedUids = new Set(result.profiles.map((profile) => profile.uid));
    const rejectedByUid = new Map(
      result.rejected
        .filter((item) => !!item.uid)
        .map((item) => [item.uid as string, item.reason])
    );

    const rows = candidates.map((profile) => ({
      uid: profile.uid,
      nickname: profile.nickname,
      gender: profile.gender ?? null,
      orientation: profile.orientation ?? null,
      normalizedGender: profile.normalizedGender ?? null,
      normalizedOrientation: profile.normalizedOrientation ?? null,
      compatibilityReady: profile.compatibilityReady ?? null,
      score: profile.compatibilityScore ?? null,
      compatibilityReason: profile.compatibilityReason ?? null,
      visibleInCompatible: acceptedUids.has(profile.uid),
      rejectedReason: rejectedByUid.get(profile.uid) ?? null,
    }));

    console.groupCollapsed(
      `[DiscoveryDebug] Perfis compatíveis: ${result.debugSummary.acceptedTotal} aceitos, ${result.debugSummary.rejectedTotal} rejeitados`
    );
    console.table(rows);
    console.info('[DiscoveryDebug] summary', result.debugSummary);
    console.groupEnd();
  }

  private withPresence(
    profile: PublicProfileCard,
    onlinePresenceByUid: Map<string, IUserDados> | null
  ): PublicProfileCard {
    const presence = onlinePresenceByUid?.get(profile.uid) ?? null;

    if (!presence) {
      return {
        ...profile,
        isOnline: profile.isOnline === true,
        lastSeen: (profile as any).lastSeen ?? null,
      };
    }

    const anyPresence = presence as any;

    return {
      ...profile,
      isOnline: anyPresence.isOnline === true,
      lastSeen: anyPresence.lastSeen ?? (profile as any).lastSeen ?? null,
      lastOnlineAt: anyPresence.lastOnlineAt ?? (profile as any).lastOnlineAt ?? null,
      lastOfflineAt: anyPresence.lastOfflineAt ?? (profile as any).lastOfflineAt ?? null,
      lastStateChangeAt: anyPresence.lastStateChangeAt ?? (profile as any).lastStateChangeAt ?? null,
      presenceState: anyPresence.presenceState ?? (profile as any).presenceState ?? null,
      presenceSessionId: anyPresence.presenceSessionId ?? (profile as any).presenceSessionId ?? null,
    } as PublicProfileCard;
  }

  private withDistance(
    profile: PublicProfileCard,
    viewerCoords: SafeGeoCoordinates | null
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

  private isInsideRadius(profile: PublicProfileCard, capKm: number): boolean {
    return (
      typeof profile.distanciaKm === 'number' &&
      Number.isFinite(profile.distanciaKm) &&
      profile.distanciaKm <= capKm
    );
  }

  private normalizeCapKm(value: number | null | undefined): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : 20;

    return Math.max(1, n);
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

    const anyUser = user as any;
    const coords = extractValidGeoCoordinates(user);

    return {
      uid,
      nickname,

      nicknameNormalized: this.toNullableText(anyUser.nicknameNormalized) ?? nickname.toLowerCase(),

      photoURL:
        this.toNullableText(anyUser.photoURL) ??
        this.toNullableText(anyUser.photoUrl) ??
        this.toNullableText(anyUser.avatarUrl) ??
        this.toNullableText(anyUser.avatarURL),

      gender: this.toNullableText(anyUser.gender) ?? this.toNullableText(anyUser.genero),

      orientation:
        this.toNullableText(anyUser.orientation) ??
        this.toNullableText(anyUser.sexualOrientation) ??
        this.toNullableText(anyUser.orientacao) ??
        this.toNullableText(anyUser.orientacaoSexual),

      normalizedGender: this.toNullableText(anyUser.normalizedGender),
      normalizedOrientation: this.toNullableText(anyUser.normalizedOrientation),

      compatibilityReady:
        typeof anyUser.compatibilityReady === 'boolean'
          ? anyUser.compatibilityReady
          : null,

      partner1Orientation:
        this.toNullableText(anyUser.partner1Orientation) ??
        this.toNullableText(anyUser.orientation1) ??
        this.toNullableText(anyUser.orientacaoParceiro1),

      partner2Orientation:
        this.toNullableText(anyUser.partner2Orientation) ??
        this.toNullableText(anyUser.orientation2) ??
        this.toNullableText(anyUser.orientacaoParceiro2),

      preferences: this.toDiscoveryPreferenceValue(anyUser.preferences ?? anyUser.preferencias),

      interestedInGenders: this.toDiscoveryPreferenceValue(
        anyUser.interestedInGenders ?? anyUser.generosDeInteresse
      ),

      interestedInOrientations: this.toDiscoveryPreferenceValue(
        anyUser.interestedInOrientations ?? anyUser.orientacoesDeInteresse
      ),

      estado:
        this.toNullableText(anyUser.estado) ??
        this.toNullableText(anyUser.uf) ??
        this.toNullableText(anyUser.state),

      municipio:
        this.toNullableText(anyUser.municipio) ??
        this.toNullableText(anyUser.cidade) ??
        this.toNullableText(anyUser.city),

      role: this.toNullableText(anyUser.role) ?? 'free',

      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      geohash: this.toNullableText(anyUser.geohash),

      isOnline: anyUser.isOnline === true,

      lastSeen: anyUser.lastSeen ?? null,
      lastOnlineAt: anyUser.lastOnlineAt ?? null,
      lastOfflineAt: anyUser.lastOfflineAt ?? null,

      createdAt: anyUser.createdAt ?? null,
      updatedAt: anyUser.updatedAt ?? null,

      mediaCount: this.toNullableNumber(anyUser.mediaCount ?? anyUser.publicMediaCount),
      photosCount: this.toNullableNumber(anyUser.photosCount ?? anyUser.publicPhotosCount),
      videosCount: this.toNullableNumber(anyUser.videosCount ?? anyUser.publicVideosCount),
      viewsCount: this.toNullableNumber(anyUser.viewsCount ?? anyUser.profileViewsCount ?? anyUser.profileViews),
      likesCount: this.toNullableNumber(anyUser.likesCount ?? anyUser.publicLikesCount),
      engagementScore: this.toNullableNumber(anyUser.engagementScore),
    } as PublicProfileCard;
  }

  private toNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();

    return text.length ? text : null;
  }

  private toDiscoveryPreferenceValue(value: unknown): readonly string[] | string | null {
    if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);

      return items.length ? items : null;
    }

    return this.toNullableText(value);
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(0, value);
  }

  private roundScore(value: number): number {
    return Number(value.toFixed(2));
  }
}
