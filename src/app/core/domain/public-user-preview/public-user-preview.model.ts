// src/app/core/domain/public-user-preview/public-user-preview.model.ts
// -----------------------------------------------------------------------------
// PUBLIC USER PREVIEW
// -----------------------------------------------------------------------------
// Dados públicos complementares usados em prévias rápidas de perfil. Identidade
// continua pertencendo a PublicUserIdentity; idade, orientação, presença, bio,
// distância e destaques públicos são contexto e nunca incluem KYC, nome civil
// ou localização precisa.
// -----------------------------------------------------------------------------

import { resolvePublicPreferenceLabel } from '../../catalogs/public-preference-options.catalog';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from '../public-user-identity/public-user-identity.model';

const MAX_PUBLIC_HIGHLIGHTS = 3;

export interface PublicUserPreview {
  readonly identity: PublicUserIdentity;
  readonly age: number | null;
  readonly orientationLabel: string | null;
  readonly isOnline: boolean;
  readonly approximateDistanceKm: number | null;
  readonly bioPreview: string | null;
  readonly highlights: readonly string[];
}

export interface PublicUserPreviewOptions {
  readonly approximateDistanceKm?: unknown;
}

function normalizeInlineText(value: unknown, maxLength: number): string | null {
  const normalized = Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 9 || codePoint === 10 || codePoint === 13) return ' ';
      return codePoint >= 32 && codePoint !== 127 ? character : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return normalized || null;
}

function normalizeAge(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const age = Math.trunc(numeric);
  return age >= 18 && age <= 120 ? age : null;
}

function normalizeDistance(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 20_000) {
    return null;
  }

  return Math.round(numeric * 10) / 10;
}

function normalizeStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function resolvePublicHighlights(source: Record<string, unknown>): readonly string[] {
  if (source['preferenceBadgesVisible'] !== true) {
    return [];
  }

  const labels: string[] = [];
  const append = (
    kind: 'relationship' | 'body_trait' | 'sexual_practice',
    values: unknown
  ) => {
    for (const value of normalizeStringArray(values)) {
      const label = resolvePublicPreferenceLabel(kind, value);
      if (!label || labels.includes(label)) continue;
      labels.push(label);
      if (labels.length >= MAX_PUBLIC_HIGHLIGHTS) return;
    }
  };

  append('relationship', source['publicRelationshipIntents']);
  if (labels.length < MAX_PUBLIC_HIGHLIGHTS) {
    append('body_trait', source['publicBodyTraits']);
  }
  if (labels.length < MAX_PUBLIC_HIGHLIGHTS) {
    append('sexual_practice', source['publicSexualPractices']);
  }

  return labels.slice(0, MAX_PUBLIC_HIGHLIGHTS);
}

export function normalizePublicUserPreview(
  raw: unknown,
  options: PublicUserPreviewOptions = {}
): PublicUserPreview | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const identity = normalizePublicUserIdentity(source);
  if (!identity) return null;

  return {
    identity,
    age: normalizeAge(source['age'] ?? source['idade']),
    orientationLabel: normalizeInlineText(
      source['orientationLabel'] ?? source['orientation'],
      80
    ),
    isOnline: source['isOnline'] === true,
    approximateDistanceKm: normalizeDistance(options.approximateDistanceKm),
    bioPreview: normalizeInlineText(
      source['bioPreview'] ?? source['descricao'],
      180
    ),
    highlights: resolvePublicHighlights(source),
  };
}
