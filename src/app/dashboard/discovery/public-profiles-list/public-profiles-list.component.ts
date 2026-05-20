// src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.ts
// -----------------------------------------------------------------------------
// PublicProfilesListComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - renderizar a lista de perfis públicos do modo "Todos";
// - exibir estados de loading, vazio e erro;
// - não consultar Firestore diretamente;
// - não decidir regra de visibilidade;
// - não misturar presença online com descoberta geral;
// - reutilizar o UserCardComponent para manter o mesmo visual dos cards.
//
// Supressão explícita desta revisão:
// - card próprio `.public-profile-card`;
// - métodos getProfileRoute(), getAvatar(), getLocationLabel() e getProfileMeta().
//
// Motivo:
// - "Todos" e "Online" devem parecer o mesmo produto;
// - duplicar card gera divergência visual, manutenção dupla e inconsistência mobile;
// - o UserCardComponent já concentra imagem, ações, orientação, localização,
//   distância e acessibilidade do card.

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';

import { PublicProfileCard } from '../models/public-profile-card.model';

type PublicProfileCardView = PublicProfileCard & {
  distanciaKm?: number | null;
  isOnline?: boolean | null;
  lastLogin?: unknown;
  descricao?: string | null;
  idade?: number | null;
  partner1Orientation?: string | null;
  partner2Orientation?: string | null;
};

const USER_TIER_ROLES = [
  'visitante',
  'free',
  'basic',
  'premium',
  'vip',
] as const;

@Component({
  selector: 'app-public-profiles-list',
  standalone: true,
  imports: [CommonModule, UserCardComponent],
  templateUrl: './public-profiles-list.component.html',
  styleUrls: ['./public-profiles-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfilesListComponent {
  readonly profiles = input<readonly PublicProfileCard[]>([]);
  readonly loading = input<boolean>(false);
  readonly errorMessage = input<string | null>(null);

  trackProfile(_: number, profile: PublicProfileCard): string {
    return profile.uid;
  }

  /**
   * Adapter visual entre PublicProfileCard e UserCardComponent.
   *
   * Importante:
   * - não altera a fonte dos dados;
   * - não consulta Firestore;
   * - apenas monta o objeto mínimo que o UserCardComponent já sabe exibir;
   * - usa undefined, não null, porque IUserDados tipa vários campos como opcionais.
   */
  toUserCardProfile(profile: PublicProfileCard): IUserDados {
    const view = profile as PublicProfileCardView;

    const userCardProfile: Partial<IUserDados> = {
      uid: profile.uid,
      nickname: this.toOptionalText(profile.nickname) ?? 'Usuário',

      photoURL:
        this.toOptionalText(profile.photoURL) ?? 'assets/imagem-padrao.webp',

      gender: this.toOptionalText(profile.gender),
      orientation: this.toOptionalText(profile.orientation),

      partner1Orientation: this.toOptionalText(view.partner1Orientation),
      partner2Orientation: this.toOptionalText(view.partner2Orientation),

      municipio: this.toOptionalText(profile.municipio),
      estado: this.toOptionalText(profile.estado),

      role: this.toUserTierRole(profile.role),

      latitude: this.toOptionalNumber(profile.latitude),
      longitude: this.toOptionalNumber(profile.longitude),
      

      isOnline: view.isOnline === true,

      /**
       * IUserDados espera number.
       * Quando não houver lastLogin real, usamos 0.
       * O UserCardComponent já trata `!user.lastLogin` como ausência de login.
       */
      lastLogin: this.toTimestampMs(view.lastLogin),

      descricao: this.toOptionalText(view.descricao),
      idade: this.toOptionalNumber(view.idade),
    };

    return userCardProfile as IUserDados;
  }

  getDistance(profile: PublicProfileCard): number | null {
    const value = (profile as PublicProfileCardView).distanciaKm;

    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;
  }

  private toOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const text = value.trim();

    return text.length ? text : undefined;
  }

  private toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());

      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private toTimestampMs(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      const time = value.getTime();

      return Number.isFinite(time) ? time : 0;
    }

    if (typeof value === 'string') {
      const time = new Date(value).getTime();

      return Number.isFinite(time) ? time : 0;
    }

    const maybeTimestamp = value as {
      toMillis?: () => number;
      toDate?: () => Date;
    } | null | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      const time = maybeTimestamp.toMillis();

      return Number.isFinite(time) ? time : 0;
    }

    if (typeof maybeTimestamp?.toDate === 'function') {
      const time = maybeTimestamp.toDate().getTime();

      return Number.isFinite(time) ? time : 0;
    }

    return 0;
  }

  private toUserTierRole(value: unknown): IUserDados['role'] {
    const role = this.toOptionalText(value)?.toLowerCase();

    if (USER_TIER_ROLES.includes(role as any)) {
      return role as IUserDados['role'];
    }

    return 'free' as IUserDados['role'];
  }
}