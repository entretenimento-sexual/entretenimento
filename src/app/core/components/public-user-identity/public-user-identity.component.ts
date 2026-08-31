// src/app/core/components/public-user-identity/public-user-identity.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from '../../domain/public-user-identity/public-user-identity.model';

export type PublicUserIdentityDensity =
  | 'compact'
  | 'standard'
  | 'comfortable';

export type PublicUserIdentityEmphasis = 'normal' | 'strong';

/**
 * Entrada tolerante apenas para a migração das superfícies legadas.
 * O componente normaliza tudo para PublicUserIdentity antes de renderizar.
 */
export type PublicUserIdentityInput =
  | PublicUserIdentity
  | Partial<PublicUserIdentity>
  | null
  | undefined;

@Component({
  selector: 'app-public-user-identity',
  standalone: true,
  templateUrl: './public-user-identity.component.html',
  styleUrl: './public-user-identity.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.public-user-identity--compact]': "density() === 'compact'",
    '[class.public-user-identity--comfortable]': "density() === 'comfortable'",
    '[class.public-user-identity--without-avatar]': '!showAvatar()',
    '[class.public-user-identity--strong]': "emphasis() === 'strong'",
  },
})
export class PublicUserIdentityComponent {
  readonly identity = input<PublicUserIdentityInput>(null);
  readonly density = input<PublicUserIdentityDensity>('standard');
  readonly emphasis = input<PublicUserIdentityEmphasis>('normal');
  readonly showAvatar = input(true);

  /** Contexto pertence à superfície, mas ocupa posição visual canônica. */
  readonly contextText = input<string | null>(null);
  readonly contextDateTime = input<string | null>(null);
  readonly contextTitle = input<string | null>(null);

  private readonly failedAvatarUrl = signal<string | null>(null);

  readonly normalizedIdentity = computed(() =>
    normalizePublicUserIdentity(this.identity())
  );

  readonly displayName = computed(() =>
    this.normalizedIdentity()?.nickname ?? 'Usuário'
  );

  readonly avatarUrl = computed(() => {
    const url = this.normalizedIdentity()?.avatarUrl ?? null;
    return url && this.failedAvatarUrl() !== url ? url : null;
  });

  readonly fallbackInitial = computed(() => {
    const [firstCharacter] = Array.from(this.displayName().trim());
    return firstCharacter?.toLocaleUpperCase('pt-BR') ?? '?';
  });

  readonly metaParts = computed<readonly string[]>(() => {
    const normalized = this.normalizedIdentity();
    const raw = this.identity();
    if (!normalized && !raw) return [];

    const identityLabel = normalized?.identityShortLabel
      ?? this.normalizeInlineText(raw?.identityShortLabel)
      ?? this.normalizeInlineText(raw?.profileTypeLabel);

    const city = normalized?.city ?? null;
    const state = normalized?.state ?? null;
    const location = city && state
      ? `${city}/${state}`
      : city ?? state;

    return [identityLabel, location].filter(
      (value): value is string => !!value
    );
  });

  readonly metaAriaLabel = computed(() =>
    this.metaParts().join('. ')
  );

  onAvatarError(): void {
    this.failedAvatarUrl.set(this.normalizedIdentity()?.avatarUrl ?? null);
  }

  private normalizeInlineText(value: unknown): string | null {
    const normalized = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    return normalized || null;
  }
}
