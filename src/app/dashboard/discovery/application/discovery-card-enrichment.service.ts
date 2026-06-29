// src/app/dashboard/discovery/application/discovery-card-enrichment.service.ts
// -----------------------------------------------------------------------------
// DiscoveryCardEnrichmentService
// -----------------------------------------------------------------------------
// Camada genérica de enriquecimento de cards de descoberta.
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
import { evaluateProfileCompatibility, ProfileCompatibilityResult } from 'src/app/core/utils/discovery/profile-compatibility.util';

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

export interface DiscoveryCardEnrichmentResult {
  profiles: PublicProfileCard[];
  rejected: DiscoveryCardRejectedItem[];
  scores: DiscoveryCardScoreDebug[];
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

      if (mode === 'all' && profile.compatibilityScore === 0) {
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

    const result: DiscoveryCardEnrichmentResult = {
      profiles: scored.map((item) => item.profile),
      rejected,
      scores: scored.map((item) => ({
        uid: item.profile.uid,
        nickname: item.profile.nickname ?? null,
        score: item.score,
      })),
    };

    this.debugCompatibleMode(mode, candidates, result);

    return result;
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
      `[DiscoveryDebug] Perfis compatíveis: ${result.profiles.length} aceitos, ${result.rejected.length} rejeitados`
    );
    console.table(rows);
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

      preferences: Array.isArray(anyUser.preferences)
        ? anyUser.preferences
        : Array.isArray(anyUser.preferencias)
          ? anyUser.preferencias
          : null,

      interestedInGenders: Array.isArray(anyUser.interestedInGenders)
        ? anyUser.interestedInGenders
        : Array.isArray(anyUser.generosDeInteresse)
          ? anyUser.generosDeInteresse
          : null,

      interestedInOrientations: Array.isArray(anyUser.interestedInOrientations)
        ? anyUser.interestedInOrientations
        : Array.isArray(anyUser.orientacoesDeInteresse)
          ? anyUser.orientacoesDeInteresse
          : null,

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

  private toNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(0, value);
  }
}
