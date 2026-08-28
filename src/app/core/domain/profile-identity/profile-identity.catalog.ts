// -----------------------------------------------------------------------------
// GENERATED PROFILE IDENTITY CATALOG
// -----------------------------------------------------------------------------
// GERADO de config/profile-identity-catalog.json. Não edite este arquivo à mão.
// Execute: node scripts/quality/build-profile-identity-catalog.mjs
// -----------------------------------------------------------------------------

export type ProfileIdentityDiscoveryGroup =
  | 'man'
  | 'woman'
  | 'couple'
  | 'trans_woman'
  | 'trans_man'
  | 'travesti'
  | 'transgender'
  | 'crossdresser'
  | 'nonbinary';

export interface ProfileIdentityOption {
  readonly code: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly discoveryGroup: ProfileIdentityDiscoveryGroup;
  readonly couple: boolean;
  readonly enabled: boolean;
  readonly selectable: boolean;
  readonly sortOrder: number;
}

export interface ProfileIdentityCatalog {
  readonly version: number;
  readonly options: readonly ProfileIdentityOption[];
}

export const PROFILE_IDENTITY_CATALOG_VERSION = 1;

export const PROFILE_IDENTITY_OPTIONS: readonly ProfileIdentityOption[] = Object.freeze(
[
    {
      "code": "homem",
      "label": "Homem",
      "shortLabel": "Homem",
      "discoveryGroup": "man",
      "couple": false,
      "enabled": true,
      "selectable": true,
      "sortOrder": 10
    },
    {
      "code": "mulher",
      "label": "Mulher",
      "shortLabel": "Mulher",
      "discoveryGroup": "woman",
      "couple": false,
      "enabled": true,
      "selectable": true,
      "sortOrder": 20
    },
    {
      "code": "casal-ele-ele",
      "label": "Casal (Ele/Ele)",
      "shortLabel": "Casal",
      "discoveryGroup": "couple",
      "couple": true,
      "enabled": true,
      "selectable": true,
      "sortOrder": 30
    },
    {
      "code": "casal-ele-ela",
      "label": "Casal (Ele/Ela)",
      "shortLabel": "Casal",
      "discoveryGroup": "couple",
      "couple": true,
      "enabled": true,
      "selectable": true,
      "sortOrder": 40
    },
    {
      "code": "casal-ela-ela",
      "label": "Casal (Ela/Ela)",
      "shortLabel": "Casal",
      "discoveryGroup": "couple",
      "couple": true,
      "enabled": true,
      "selectable": true,
      "sortOrder": 50
    },
    {
      "code": "travesti",
      "label": "Travesti",
      "shortLabel": "Travesti",
      "discoveryGroup": "travesti",
      "couple": false,
      "enabled": true,
      "selectable": true,
      "sortOrder": 60
    },
    {
      "code": "transexual",
      "label": "Pessoa trans",
      "shortLabel": "Pessoa trans",
      "discoveryGroup": "transgender",
      "couple": false,
      "enabled": true,
      "selectable": true,
      "sortOrder": 70
    },
    {
      "code": "crossdressers",
      "label": "Crossdresser",
      "shortLabel": "Crossdresser",
      "discoveryGroup": "crossdresser",
      "couple": false,
      "enabled": true,
      "selectable": true,
      "sortOrder": 80
    }
  ]
);

export const PROFILE_IDENTITY_CATALOG: ProfileIdentityCatalog = Object.freeze({
  version: PROFILE_IDENTITY_CATALOG_VERSION,
  options: PROFILE_IDENTITY_OPTIONS,
});

const PROFILE_IDENTITY_BY_CODE = new Map(
  PROFILE_IDENTITY_OPTIONS.map((option) => [option.code, option] as const)
);

export const SELECTABLE_PROFILE_IDENTITY_OPTIONS = Object.freeze(
  PROFILE_IDENTITY_OPTIONS
    .filter((option) => option.enabled && option.selectable)
    .slice()
    .sort((first, second) => first.sortOrder - second.sortOrder)
);

export function resolveProfileIdentityOption(
  code: unknown
): ProfileIdentityOption | null {
  const normalized = String(code ?? '').trim().toLowerCase();
  return PROFILE_IDENTITY_BY_CODE.get(normalized) ?? null;
}

export function resolveProfileIdentityDiscoveryGroup(
  code: unknown
): ProfileIdentityDiscoveryGroup | null {
  return resolveProfileIdentityOption(code)?.discoveryGroup ?? null;
}

export function isSelectableProfileIdentityCode(code: unknown): boolean {
  const option = resolveProfileIdentityOption(code);
  return option?.enabled === true && option.selectable === true;
}

export function isCoupleProfileIdentityCode(code: unknown): boolean {
  return resolveProfileIdentityOption(code)?.couple === true;
}
