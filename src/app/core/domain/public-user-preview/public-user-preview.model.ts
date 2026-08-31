// src/app/core/domain/public-user-preview/public-user-preview.model.ts
// -----------------------------------------------------------------------------
// PUBLIC USER PREVIEW
// -----------------------------------------------------------------------------
// Dados públicos complementares usados em prévias rápidas de perfil. Identidade
// continua pertencendo a PublicUserIdentity; idade, orientação, presença, bio e
// distância são contexto público e nunca incluem KYC, nome civil ou localização
// precisa.
// -----------------------------------------------------------------------------

import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from '../public-user-identity/public-user-identity.model';

export interface PublicUserPreview {
  readonly identity: PublicUserIdentity;
  readonly age: number | null;
  readonly orientationLabel: string | null;
  readonly isOnline: boolean;
  readonly approximateDistanceKm: number | null;
  readonly bioPreview: string | null;
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
  };
}
