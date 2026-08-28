// src/app/store/effects/effects.user/online-users-profile-comparator.service.ts
// =============================================================================
// SERVIÇO: ONLINE USERS PROFILE COMPARATOR
// =============================================================================
//
// Responsabilidade:
// - normalizar presença para o modo Online;
// - gerar fingerprint estável da lista de presence;
// - comparar perfis públicos antes de atualizar usersMap;
// - evitar dispatch/update desnecessário no NgRx.
//
// Regra de arquitetura:
// - este service NÃO consulta Firestore;
// - este service NÃO despacha actions;
// - este service NÃO hidrata public_profiles;
// - este service NÃO calcula score;
// - este service NÃO ordena discovery.
//
// O ranking de cards continua no DiscoveryCardEnrichmentService.

import { Injectable } from '@angular/core';

import { IUserDados } from '@core/interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class OnlineUsersProfileComparatorService {
  /**
   * Normaliza texto livre para comparação e UID.
   *
   * Mantido público porque o effect ainda precisa limpar UID em pontos pequenos
   * de orchestration, sem reter helpers duplicados.
   */
  toCleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();

    return text.length ? text : null;
  }

  /**
   * Normaliza a lista de presence.
   *
   * Aqui fazemos apenas:
   * - array seguro;
   * - UID válido;
   * - remoção do próprio usuário;
   * - deduplicação.
   *
   * A elegibilidade pública final permanece no pipeline de discovery/card.
   */
  normalizePresenceUsers(
    users: IUserDados[] | null | undefined,
    currentUid: string | null
  ): IUserDados[] {
    const list = Array.isArray(users) ? users : [];
    const seen = new Set<string>();

    return list.filter((user) => {
      const uid = this.toCleanText((user as any)?.uid);

      if (!uid) {
        return false;
      }

      if (currentUid && uid === currentUid) {
        return false;
      }

      if (seen.has(uid)) {
        return false;
      }

      seen.add(uid);

      return true;
    });
  }

  /**
   * Decide se o perfil público recebido precisa atualizar o usersMap.
   */
  shouldUpsertProfile(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (!incoming?.uid) {
      return false;
    }

    if (!current) {
      return true;
    }

    return !this.areProfilesEquivalent(current, incoming);
  }

  /**
   * Gera uma assinatura estável apenas para mudanças que alteram a composição
   * ou o status imediatamente exibível da lista Online.
   *
   * Não entram no fingerprint:
   * - lastSeen;
   * - lastOnlineAt;
   * - lastOfflineAt;
   * - lastStateChangeAt;
   * - presenceSessionId.
   *
   * Motivo:
   * timestamps e sessão são dados operacionais da presença. Eles podem mudar
   * sem alterar os cards que precisam ser exibidos ou reidratados.
   */
  buildPresenceFingerprint(
    users: IUserDados[] | null | undefined,
    currentUid: string | null
  ): string {
    const normalized = this.normalizePresenceUsers(users, currentUid)
      .map((user) => {
        const anyUser = user as any;

        return {
          uid: this.toCleanText(anyUser.uid),
          isOnline: anyUser.isOnline === true,
          presenceState: this.toComparableText(anyUser.presenceState),
        };
      })
      .filter(
        (item): item is {
          uid: string;
          isOnline: boolean;
          presenceState: string;
        } => !!item.uid
      )
      .sort((a, b) =>
        a.uid.localeCompare(b.uid, 'pt-BR', {
          sensitivity: 'base',
        })
      );

    return JSON.stringify(normalized);
  }

  private areProfilesEquivalent(
    current: IUserDados | null | undefined,
    incoming: IUserDados | null | undefined
  ): boolean {
    if (current === incoming) {
      return true;
    }

    if (!current || !incoming) {
      return false;
    }

    const a = this.toComparablePublicProfile(current);
    const b = this.toComparablePublicProfile(incoming);

    if (!a || !b) {
      return false;
    }

    return Object.keys(b).every((key) => a[key] === b[key]);
  }

  /**
   * Recorte público comparável.
   *
   * Se campos públicos do card mudarem em public_profiles, o usersMap precisa
   * ser atualizado. Isso inclui localização, identidade pública e métricas
   * agregadas de mídia usadas pelo ranking canônico.
   */
  private toComparablePublicProfile(
    user: IUserDados | null | undefined
  ): Record<string, unknown> | null {
    if (!user?.uid) {
      return null;
    }

    const anyUser = user as any;

    return {
      uid: this.toComparableText(anyUser.uid),

      nickname: this.toComparableText(anyUser.nickname),
      nicknameNormalized: this.toComparableText(anyUser.nicknameNormalized),

      photoURL: this.toComparableText(
        anyUser.photoURL ??
          anyUser.photoUrl ??
          anyUser.avatarUrl ??
          anyUser.avatarURL
      ),

      role: this.toComparableText(anyUser.role ?? 'free'),

      gender: this.toComparableText(
        anyUser.gender ??
          anyUser.genero
      ),

      orientation: this.toComparableText(
        anyUser.orientation ??
          anyUser.sexualOrientation ??
          anyUser.orientacao ??
          anyUser.orientacaoSexual
      ),

      estado: this.toComparableText(
        anyUser.estado ??
          anyUser.uf ??
          anyUser.state
      ),

      municipio: this.toComparableText(
        anyUser.municipio ??
          anyUser.cidade ??
          anyUser.city
      ),

      latitude: this.toComparableCoordinate(
        anyUser.latitude ??
          anyUser.lat
      ),

      longitude: this.toComparableCoordinate(
        anyUser.longitude ??
          anyUser.lng ??
          anyUser.lon
      ),

      geohash: this.toComparableText(anyUser.geohash),

      /**
       * Métricas públicas canônicas.
       *
       * Se uma dessas métricas mudar, o perfil público materializado no store
       * precisa ser atualizado para que o modo Online use o mesmo ranking do
       * discovery geral.
       */
      mediaCount: this.toOptionalNumber(
        anyUser.mediaCount ??
          anyUser.publicMediaCount
      ),

      photosCount: this.toOptionalNumber(
        anyUser.photosCount ??
          anyUser.publicPhotosCount
      ),

      videosCount: this.toOptionalNumber(
        anyUser.videosCount ??
          anyUser.publicVideosCount
      ),

      viewsCount: this.toOptionalNumber(
        anyUser.viewsCount ??
          anyUser.profileViewsCount ??
          anyUser.profileViews
      ),

      likesCount: this.toOptionalNumber(
        anyUser.likesCount ??
          anyUser.publicLikesCount ??
          anyUser.reactionsCount
      ),

      reactionsCount: this.toOptionalNumber(anyUser.reactionsCount),
      uniqueViewersCount: this.toOptionalNumber(anyUser.uniqueViewersCount),
      viewScore: this.toOptionalNumber(anyUser.viewScore),
      engagementScore: this.toOptionalNumber(anyUser.engagementScore),
      profileCompletenessScore: this.toOptionalNumber(
        anyUser.profileCompletenessScore
      ),

      mediaMetricsUpdatedAt: this.toComparableText(anyUser.mediaMetricsUpdatedAt),
    };
  }

  private toComparableText(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  private toComparableCoordinate(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(n)) {
      return null;
    }

    /**
     * Evita que diferença irrelevante de precisão gere update desnecessário.
     */
    return Number(n.toFixed(6));
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
}
