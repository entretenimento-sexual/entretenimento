// src/app/dashboard/discovery/application/discovery-card-enrichment.service.ts
// -----------------------------------------------------------------------------
// DiscoveryCardEnrichmentService
// -----------------------------------------------------------------------------
// FONTE CANÔNICA DO PIPELINE DE DISCOVERY:
// perfil público -> presença -> distância -> compatibilidade -> preferências do
// viewer -> visibilidade -> score -> ordenação -> debug.
// -----------------------------------------------------------------------------

import { Injectable, inject, isDevMode } from '@angular/core';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
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
  evaluateProfileCompatibility,
  ProfileCompatibilityResult,
} from 'src/app/core/utils/discovery/profile-compatibility.util';
import {
  DiscoveryPreferenceRejectionReason,
  evaluateDiscoveryCandidatePreference,
} from 'src/app/core/utils/discovery/profile-type-preference-filter.util';

import {
  DiscoveryMode,
  DEFAULT_DISCOVERY_MODE,
  discoveryModeRequiresLocation,
  normalizeDiscoveryMode,
} from '../models/discovery-mode.model';
import type { PublicProfileCard } from '../models/public-profile-card.model';

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

type DiscoveryCardRejectionReason =
  | NonNullable<PublicDiscoveryProfileRejectionReason>
  | DiscoveryPreferenceRejectionReason
  | 'current_user'
  | 'outside_radius'
  | 'incompatible_profile';

type EvaluatedCard = PublicProfileCard & {
  preferenceRejectionReason?: DiscoveryPreferenceRejectionReason | null;
};

export interface DiscoveryCardRejectedItem {
  uid: string | null;
  nickname: string | null;
  reason: DiscoveryCardRejectionReason;
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
  rejectedByReason: Partial<Record<DiscoveryCardRejectionReason, number>>;
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
    preferenceMatchScore: number | null;
  }>;
}

export interface DiscoveryCardEnrichmentResult {
  profiles: PublicProfileCard[];
  rejected: DiscoveryCardRejectedItem[];
  scores: DiscoveryCardScoreDebug[];
  debugSummary: DiscoveryCardDebugSummary;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryCardEnrichmentService {
  private readonly distanceCalculation = inject(DistanceCalculationService);

  buildCards(input: DiscoveryCardEnrichmentInput): PublicProfileCard[] {
    return this.buildCardsResult(input).profiles;
  }

  buildCardsResult(input: DiscoveryCardEnrichmentInput): DiscoveryCardEnrichmentResult {
    const mode = normalizeDiscoveryMode(input.mode ?? DEFAULT_DISCOVERY_MODE);
    const currentUid = this.toNullableText(input.currentUid)
      ?? this.toNullableText(input.currentUser?.uid);
    const viewerCoords = this.resolveViewerCoordinates(
      input.currentUser,
      input.fallbackLocation ?? null
    );
    const capKm = this.normalizeCapKm(input.capKm);
    const applyVisibility = input.applyVisibility !== false;
    const rejected: DiscoveryCardRejectedItem[] = [];

    const candidates: EvaluatedCard[] = (input.profiles ?? [])
      .map((profile) => this.toPublicProfileCard(profile))
      .filter((profile): profile is PublicProfileCard => !!profile)
      .map((profile) => this.withPresence(profile, input.onlinePresenceByUid ?? null))
      .map((profile) => this.withDistance(profile, viewerCoords))
      .map((profile) => this.withCompatibility(profile, input.currentUser))
      .map((profile) => this.withPreferencePolicy(profile, input.currentUser));

    const eligible = candidates.filter((profile) => {
      if (currentUid && profile.uid === currentUid) {
        this.reject(rejected, profile, 'current_user');
        return false;
      }

      if (applyVisibility) {
        const reason = getPublicDiscoveryProfileRejectionReason(profile as never, { mode });
        if (reason !== null) {
          this.reject(rejected, profile, reason);
          return false;
        }
      }

      if (profile.preferenceRejectionReason) {
        this.reject(rejected, profile, profile.preferenceRejectionReason);
        return false;
      }

      if (mode === 'compatible' && this.isIncompatibleForCompatibleMode(profile)) {
        this.reject(rejected, profile, 'incompatible_profile');
        return false;
      }

      if (mode === 'all' && this.isClearIncompatibilityForAllMode(profile)) {
        this.reject(rejected, profile, 'incompatible_profile');
        return false;
      }

      if (discoveryModeRequiresLocation(mode) && !this.isInsideRadius(profile, capKm)) {
        this.reject(rejected, profile, 'outside_radius');
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
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      return compareDiscoverableProfilesStable(a.profile, b.profile);
    });

    const profiles = scored.map(({ profile }) => this.stripInternalFields(profile));
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

  private withPreferencePolicy(
    profile: PublicProfileCard,
    currentUser: IUserDados | null
  ): EvaluatedCard {
    const preference = evaluateDiscoveryCandidatePreference(currentUser, profile as IUserDados);
    const canonicalCompatibility = this.toUnitScore(profile.compatibilityScore, 0.5);
    const blendedCompatibility = this.clamp01(
      canonicalCompatibility * 0.7 + preference.preferenceScore * 0.3
    );

    return {
      ...profile,
      compatibilityScore: blendedCompatibility,
      preferenceMatchScore: preference.preferenceScore,
      preferenceMatchReasons: preference.matchedSignals,
      preferenceRejectionReason: preference.reason,
    };
  }

  private withCompatibility(
    profile: PublicProfileCard,
    currentUser: IUserDados | null
  ): PublicProfileCard {
    const result: ProfileCompatibilityResult = evaluateProfileCompatibility(currentUser, profile);
    return {
      ...profile,
      compatibilityScore: result.score,
      compatibilityReason: result.reason,
    };
  }

  private buildDebugSummary(input: {
    mode: DiscoveryMode;
    sourceTotal: number;
    candidates: readonly EvaluatedCard[];
    profiles: readonly PublicProfileCard[];
    rejected: readonly DiscoveryCardRejectedItem[];
    scores: readonly DiscoveryCardScoreDebug[];
  }): DiscoveryCardDebugSummary {
    const rejectedByReason: Partial<Record<DiscoveryCardRejectionReason, number>> = {};
    for (const item of input.rejected) {
      rejectedByReason[item.reason] = (rejectedByReason[item.reason] ?? 0) + 1;
    }

    const byUid = new Map(input.candidates.map((profile) => [profile.uid, profile]));

    return {
      mode: input.mode,
      sourceTotal: input.sourceTotal,
      candidateTotal: input.candidates.length,
      acceptedTotal: input.profiles.length,
      rejectedTotal: input.rejected.length,
      onlineTotal: input.profiles.filter((profile) => profile.isOnline === true).length,
      withDistanceTotal: input.profiles.filter((profile) => typeof profile.distanciaKm === 'number').length,
      withMediaTotal: input.profiles.filter((profile) => (profile.mediaCount ?? 0) > 0 || (profile.photosCount ?? 0) > 0).length,
      withVideoTotal: input.profiles.filter((profile) => (profile.videosCount ?? 0) > 0).length,
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
        preferenceMatchScore: byUid.get(item.uid)?.preferenceMatchScore ?? null,
      })),
    };
  }

  private withPresence(
    profile: PublicProfileCard,
    onlinePresenceByUid: Map<string, IUserDados> | null
  ): PublicProfileCard {
    const presence = onlinePresenceByUid?.get(profile.uid) as (IUserDados & Record<string, unknown>) | null;
    if (!presence) return { ...profile, isOnline: profile.isOnline === true };

    return {
      ...profile,
      isOnline: presence.isOnline === true,
      lastSeen: presence.lastSeen ?? profile.lastSeen ?? null,
      lastOnlineAt: presence.lastOnlineAt ?? profile.lastOnlineAt ?? null,
      lastOfflineAt: presence.lastOfflineAt ?? profile.lastOfflineAt ?? null,
    };
  }

  private withDistance(
    profile: PublicProfileCard,
    viewerCoords: SafeGeoCoordinates | null
  ): PublicProfileCard {
    if (!viewerCoords) return { ...profile, distanciaKm: null };
    const profileCoords = extractValidGeoCoordinates(profile);
    if (!profileCoords) return { ...profile, distanciaKm: null };

    return {
      ...profile,
      distanciaKm: this.distanceCalculation.calculateDistanceInKm(
        viewerCoords.latitude,
        viewerCoords.longitude,
        profileCoords.latitude,
        profileCoords.longitude
      ),
    };
  }

  private toPublicProfileCard(user: IUserDados): PublicProfileCard | null {
    const uid = this.toNullableText(user?.uid);
    const nickname = this.toNullableText(user?.nickname);
    if (!uid || !nickname) return null;

    const source = user as IUserDados & Record<string, unknown>;
    const coords = extractValidGeoCoordinates(user);

    return {
      uid,
      nickname,
      nicknameNormalized: this.toNullableText(source['nicknameNormalized']) ?? nickname.toLowerCase(),
      photoURL: this.toNullableText(source['photoURL']) ?? this.toNullableText(source['photoUrl']) ?? this.toNullableText(source['avatarUrl']),
      gender: this.toNullableText(source['gender']) ?? this.toNullableText(source['genero']),
      orientation: this.toNullableText(source['orientation']) ?? this.toNullableText(source['sexualOrientation']) ?? this.toNullableText(source['orientacao']),
      age: this.toNullableNumber(source['age'] ?? source['idade']),
      normalizedGender: this.toNullableText(source['normalizedGender']),
      normalizedOrientation: this.toNullableText(source['normalizedOrientation']),
      compatibilityReady: typeof source['compatibilityReady'] === 'boolean' ? source['compatibilityReady'] : null,
      partner1Orientation: this.toNullableText(source['partner1Orientation']) ?? this.toNullableText(source['orientation1']),
      partner2Orientation: this.toNullableText(source['partner2Orientation']) ?? this.toNullableText(source['orientation2']),
      preferences: this.toDiscoveryPreferenceValue(source['preferences'] ?? source['preferencias']),
      interestedInGenders: this.toDiscoveryPreferenceValue(source['interestedInGenders'] ?? source['generosDeInteresse']),
      interestedInOrientations: this.toDiscoveryPreferenceValue(source['interestedInOrientations'] ?? source['orientacoesDeInteresse']),
      publicRelationshipIntents: this.toStringArray(source['publicRelationshipIntents']),
      publicSexualPractices: this.toStringArray(source['publicSexualPractices']),
      publicBodyTraits: this.toStringArray(source['publicBodyTraits']),
      preferenceBadgesVisible: typeof source['preferenceBadgesVisible'] === 'boolean' ? source['preferenceBadgesVisible'] : null,
      publicPreferencesUpdatedAt: this.toNullableNumber(source['publicPreferencesUpdatedAt']),
      estado: this.toNullableText(source['estado']) ?? this.toNullableText(source['uf']) ?? this.toNullableText(source['state']),
      municipio: this.toNullableText(source['municipio']) ?? this.toNullableText(source['cidade']) ?? this.toNullableText(source['city']),
      role: this.toNullableText(source['role']) ?? 'free',
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      geohash: this.toNullableText(source['geohash']),
      isOnline: source['isOnline'] === true,
      lastSeen: source['lastSeen'] as number | null ?? null,
      lastOnlineAt: source['lastOnlineAt'] as number | null ?? null,
      lastOfflineAt: source['lastOfflineAt'] as number | null ?? null,
      createdAt: source['createdAt'] as number | null ?? null,
      updatedAt: source['updatedAt'] as number | null ?? null,
      mediaCount: this.toNullableNumber(source['mediaCount'] ?? source['publicMediaCount']),
      photosCount: this.toNullableNumber(source['photosCount'] ?? source['publicPhotosCount']),
      videosCount: this.toNullableNumber(source['videosCount'] ?? source['publicVideosCount']),
      viewsCount: this.toNullableNumber(source['viewsCount'] ?? source['profileViewsCount']),
      likesCount: this.toNullableNumber(source['likesCount'] ?? source['publicLikesCount']),
      engagementScore: this.toNullableNumber(source['engagementScore']),
    };
  }

  private resolveViewerCoordinates(
    currentUser: IUserDados | null,
    fallbackLocation: SafeGeoCoordinates | null
  ): SafeGeoCoordinates | null {
    return extractValidGeoCoordinates(currentUser) ?? extractValidGeoCoordinates(fallbackLocation);
  }

  private isInsideRadius(profile: PublicProfileCard, capKm: number): boolean {
    return typeof profile.distanciaKm === 'number'
      && Number.isFinite(profile.distanciaKm)
      && profile.distanciaKm <= capKm;
  }

  private normalizeCapKm(value: number | null | undefined): number {
    return Math.max(1, typeof value === 'number' && Number.isFinite(value) ? value : 20);
  }

  private isIncompatibleForCompatibleMode(profile: PublicProfileCard): boolean {
    return profile.compatibilityReady === false
      || profile.compatibilityScore === 0
      || profile.compatibilityReason === 'viewer_data_missing'
      || profile.compatibilityReason === 'candidate_data_missing';
  }

  private isClearIncompatibilityForAllMode(profile: PublicProfileCard): boolean {
    return profile.compatibilityScore === 0 && [
      'viewer_not_interested',
      'candidate_not_interested',
      'mutual_mismatch',
    ].includes(profile.compatibilityReason ?? '');
  }

  private reject(
    target: DiscoveryCardRejectedItem[],
    profile: PublicProfileCard,
    reason: DiscoveryCardRejectionReason
  ): void {
    target.push({ uid: profile.uid ?? null, nickname: profile.nickname ?? null, reason });
  }

  private stripInternalFields(profile: EvaluatedCard): PublicProfileCard {
    const { preferenceRejectionReason: _internal, ...publicProfile } = profile;
    return publicProfile;
  }

  private toNullableText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length ? text : null;
  }

  private toDiscoveryPreferenceValue(value: unknown): readonly string[] | string | null {
    if (Array.isArray(value)) return this.toStringArray(value);
    return this.toNullableText(value);
  }

  private toStringArray(value: unknown): readonly string[] | null {
    if (!Array.isArray(value)) return null;
    const items = Array.from(new Set(
      value.filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    ));
    return items.length ? items : null;
  }

  private toNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }

  private toUnitScore(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return this.clamp01(value > 1 ? value / 100 : value);
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private roundScore(value: number): number {
    return Number(value.toFixed(2));
  }

  private debugCompatibleMode(
    mode: DiscoveryMode,
    candidates: readonly EvaluatedCard[],
    result: DiscoveryCardEnrichmentResult
  ): void {
    if (!isDevMode() || mode !== 'compatible') return;

    const acceptedUids = new Set(result.profiles.map((profile) => profile.uid));
    const rejectedByUid = new Map(
      result.rejected.filter((item) => !!item.uid).map((item) => [item.uid as string, item.reason])
    );

    console.groupCollapsed(
      `[DiscoveryDebug] Perfis compatíveis: ${result.debugSummary.acceptedTotal} aceitos, ${result.debugSummary.rejectedTotal} rejeitados`
    );
    console.table(candidates.map((profile) => ({
      uid: profile.uid,
      nickname: profile.nickname,
      compatibilityScore: profile.compatibilityScore ?? null,
      preferenceMatchScore: profile.preferenceMatchScore ?? null,
      preferenceSignals: profile.preferenceMatchReasons ?? [],
      visibleInCompatible: acceptedUids.has(profile.uid),
      rejectedReason: rejectedByUid.get(profile.uid) ?? null,
    })));
    console.info('[DiscoveryDebug] summary', result.debugSummary);
    console.groupEnd();
  }
}
