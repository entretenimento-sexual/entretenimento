// functions/src/community/community-public-location.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY PUBLIC LOCATION
// -----------------------------------------------------------------------------
// Projeção coarse e explicitamente pública para superfícies de descoberta.
// Nunca contém coordenadas, endereço completo, número, CEP ou texto livre de
// referência. O documento de Local continua sendo a fonte canônica do domínio.
// -----------------------------------------------------------------------------

export interface CommunityPublicLocation {
  readonly uf: string;
  readonly city: string;
  readonly district: string | null;
}

const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

function normalizeText(value: unknown, maxLength: number): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeCommunityPublicLocation(
  raw: unknown
): CommunityPublicLocation | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const uf = normalizeText(source['uf'], 2).toUpperCase();
  const city = normalizeText(source['city'], 80);
  const district = normalizeText(source['district'], 80);

  if (!BRAZILIAN_UFS.has(uf) || city.length < 1) {
    return null;
  }

  return {
    uf,
    city,
    district: district || null,
  };
}

export function areCommunityPublicLocationsEqual(
  left: CommunityPublicLocation | null,
  right: CommunityPublicLocation | null
): boolean {
  return left?.uf === right?.uf
    && left?.city === right?.city
    && left?.district === right?.district;
}
