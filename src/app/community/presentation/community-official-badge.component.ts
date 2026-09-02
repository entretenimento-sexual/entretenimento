// src/app/community/presentation/community-official-badge.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { resolveCommunityOfficialPresentation } from './community-official.presentation';

const LOCATION_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

function capitalizeLocationToken(value: string): string {
  const characters = [...value];
  const first = characters.shift();
  return first ? `${first.toLocaleUpperCase('pt-BR')}${characters.join('')}` : '';
}

function formatLocationPart(value: string): string {
  return value
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && LOCATION_CONNECTORS.has(word)) return word;
      return word
        .split('-')
        .map(capitalizeLocationToken)
        .join('-');
    })
    .join(' ');
}

@Component({
  selector: 'app-community-official-badge',
  standalone: true,
  template: `
    @if (presentation(); as official) {
      <span
        class="community-official-badge"
        [attr.aria-label]="official.ariaLabel"
      >
        <i class="fas fa-circle-check" aria-hidden="true"></i>
        <span>{{ official.label }}</span>
      </span>

      @if (locationLabel(); as location) {
        <span
          class="community-official-location"
          [attr.aria-label]="'Localização pública: ' + location"
        >
          <i class="fas fa-location-dot" aria-hidden="true"></i>
          <span>{{ location }}</span>
        </span>
      }
    }
  `,
  styleUrl: './community-official-badge.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOfficialBadgeComponent {
  readonly community = input<CommunityPreviewCard | null | undefined>(null);

  readonly presentation = computed(() =>
    resolveCommunityOfficialPresentation(this.community())
  );

  readonly locationLabel = computed(() => {
    if (!this.presentation()) return null;

    const community = this.community();
    const location = community?.source.type === 'venue'
      ? community.publicLocation
      : null;
    if (!location) return null;

    const city = formatLocationPart(location.city);
    const district = location.district
      ? formatLocationPart(location.district)
      : null;

    if (!city) return null;
    return district
      ? `${district} · ${city}, ${location.uf}`
      : `${city}, ${location.uf}`;
  });
}
