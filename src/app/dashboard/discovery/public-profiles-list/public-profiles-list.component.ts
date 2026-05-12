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
// - não misturar presença online com descoberta geral.
//
// Motivo:
// este componente é apenas visual. A busca de dados ficará em service/facade,
// evitando que a UI vire dona de regra de negócio.

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { PublicProfileCard } from '../models/public-profile-card.model';

@Component({
  selector: 'app-public-profiles-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
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

  getProfileRoute(profile: PublicProfileCard): any[] {
    return ['/perfil', profile.uid];
  }

  getAvatar(profile: PublicProfileCard): string {
    return profile.photoURL?.trim() || 'assets/imagem-padrao.webp';
  }

  getLocationLabel(profile: PublicProfileCard): string {
    const municipio = profile.municipio?.trim();
    const estado = profile.estado?.trim();

    if (municipio && estado) return `${municipio}, ${estado}`;
    if (municipio) return municipio;
    if (estado) return estado;

    return 'Localização não informada';
  }

  getProfileMeta(profile: PublicProfileCard): string {
    const parts = [
      profile.gender?.trim(),
      profile.orientation?.trim(),
    ].filter(Boolean);

    return parts.length ? parts.join(' • ') : 'Perfil público';
  }
}
/* 
Componente preparado para receber perfis por Input, sem consultar Firestore diretamente. 
Isso mantém a arquitetura limpa. 
A página pai ou uma facade/service depois ficam responsáveis por buscar public_profiles 
*/