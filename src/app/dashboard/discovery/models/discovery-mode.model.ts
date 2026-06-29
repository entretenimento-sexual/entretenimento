// src/app/dashboard/discovery/models/discovery-mode.model.ts
// -----------------------------------------------------------------------------
// DiscoveryModeModel
// -----------------------------------------------------------------------------
//
// Registro central dos modos nativos de descoberta.
//
// Responsabilidade:
// - evitar strings soltas em componentes;
// - manter "Todos" como modo padrão;
// - alimentar a barra visual DiscoveryModeTabsComponent;
// - declarar regras de produto por modo:
//   - exige localização;
//   - exige presença online;
//   - origem principal dos dados;
//   - disponibilidade atual;
// - preparar evolução para Região, Recentes, Bombando, Compatíveis e outros.
//
// Regra importante:
// - este arquivo NÃO busca dados;
// - este arquivo NÃO calcula score;
// - este arquivo NÃO filtra perfis sozinho;
// - ele apenas descreve os modos disponíveis para outras camadas.
//
// Camadas consumidoras esperadas:
// - DiscoveryModeTabsComponent: usa tabs visuais;
// - ProfilesDiscoveryPageComponent: decide qual fluxo renderizar;
// - DiscoveryCardEnrichmentService: usa mode para aplicar score/filtros;
// - futuras facades/orchestrators: usam source/requiresLocation/requiresOnlinePresence.

export const DISCOVERY_MODE_VALUES = [
  'all',
  'online',
  'nearby',
  'region',
  'recent',
  'trending',
  'compatible',
] as const;

export type DiscoveryMode = (typeof DISCOVERY_MODE_VALUES)[number];

export type DiscoveryModeSource =
  | 'public_profiles'
  | 'presence'
  | 'geolocation'
  | 'score'
  | 'compatibility';

export type DiscoveryModeAvailability =
  | 'enabled'
  | 'disabled'
  | 'planned';

export interface DiscoveryModeConfig {
  id: DiscoveryMode;

  /**
   * Origem conceitual principal do modo.
   *
   * Isso não obriga a implementação a usar uma única fonte.
   * Exemplo:
   * - "Todos" nasce de public_profiles, mas pode receber presença como bônus;
   * - "Online" nasce da presence, mas usa public_profiles para o card;
   * - "Perto" pode nascer de public_profiles + geohash/localização.
   */
  source: DiscoveryModeSource;

  /**
   * Quando true, o modo precisa de localização ativa do usuário.
   *
   * Exemplo:
   * - nearby: true;
   * - all/online/region: false.
   */
  requiresLocation: boolean;

  /**
   * Quando true, o modo só faz sentido para perfis com presença online.
   *
   * Exemplo:
   * - online: true.
   */
  requiresOnlinePresence: boolean;

  /**
   * Disponibilidade atual do modo.
   *
   * enabled:
   *   pode ser clicado.
   *
   * disabled/planned:
   *   aparece na barra para comunicar evolução, mas não é clicável.
   */
  availability: DiscoveryModeAvailability;

  /**
   * Campos visuais usados pela barra.
   */
  label: string;
  shortLabel?: string;
  icon: string;
  ariaLabel: string;
  badge?: string;
  description?: string;

  /**
   * Futuro:
   * - pode controlar liberação por assinatura sem espalhar regra.
   */
  minimumRole?: 'free' | 'basic' | 'premium' | 'vip';
}

export interface DiscoveryModeTab {
  id: DiscoveryMode;
  label: string;
  shortLabel?: string;
  icon: string;
  ariaLabel: string;
  disabled?: boolean;
  badge?: string;
  description?: string;
}

/**
 * Default recomendado:
 * - "Todos" como entrada principal da descoberta;
 * - não exige localização;
 * - usa ranking refinado;
 * - online, distância e compatibilidade entram como bônus, não como bloqueio.
 */
export const DEFAULT_DISCOVERY_MODE: DiscoveryMode = 'all';

export const DISCOVERY_MODE_CONFIGS: Record<DiscoveryMode, DiscoveryModeConfig> = {
  all: {
    id: 'all',
    source: 'public_profiles',
    requiresLocation: false,
    requiresOnlinePresence: false,
    availability: 'enabled',

    label: 'Todos',
    icon: 'fas fa-users',
    ariaLabel: 'Ver todos os perfis',
  },

  online: {
    id: 'online',
    source: 'presence',
    requiresLocation: false,
    requiresOnlinePresence: true,
    availability: 'enabled',

    label: 'Online',
    icon: 'fas fa-bolt',
    ariaLabel: 'Ver perfis online',
  },

  nearby: {
    id: 'nearby',
    source: 'geolocation',
    requiresLocation: true,
    requiresOnlinePresence: false,
    availability: 'planned',

    label: 'Perto',
    icon: 'fas fa-location-dot',
    ariaLabel: 'Ver perfis próximos',
    badge: 'em breve',
  },

  region: {
    id: 'region',
    source: 'public_profiles',
    requiresLocation: false,
    requiresOnlinePresence: false,
    availability: 'planned',

    label: 'Região',
    icon: 'fas fa-map-location-dot',
    ariaLabel: 'Ver perfis por região',
    badge: 'em breve',
  },

  recent: {
    id: 'recent',
    source: 'score',
    requiresLocation: false,
    requiresOnlinePresence: false,
    availability: 'planned',

    label: 'Recentes',
    icon: 'fas fa-clock',
    ariaLabel: 'Ver perfis recentes',
    badge: 'em breve',
  },

  trending: {
    id: 'trending',
    source: 'score',
    requiresLocation: false,
    requiresOnlinePresence: false,
    availability: 'planned',

    label: 'Bombando',
    icon: 'fas fa-fire',
    ariaLabel: 'Ver perfis em destaque',
    badge: 'em breve',
  },

  compatible: {
    id: 'compatible',
    source: 'compatibility',
    requiresLocation: false,
    requiresOnlinePresence: false,
    availability: 'planned',

    label: 'Compatíveis',
    icon: 'fas fa-heart',
    ariaLabel: 'Ver perfis compatíveis',
    badge: 'em breve',
  },
} as const;

/**
 * Lista visual usada pela barra.
 *
 * Mantém o nome atual para não quebrar ProfilesDiscoveryPageComponent.
 */
export const DISCOVERY_MODE_TABS: readonly DiscoveryModeTab[] =
  DISCOVERY_MODE_VALUES.map((mode) => {
    const config = DISCOVERY_MODE_CONFIGS[mode];

    return {
      id: config.id,
      label: config.label,
      shortLabel: config.shortLabel,
      icon: config.icon,
      ariaLabel: config.ariaLabel,
      disabled: config.availability !== 'enabled',
      badge: config.badge,
      description: config.description,
    };
  });

export function isDiscoveryMode(value: unknown): value is DiscoveryMode {
  return DISCOVERY_MODE_VALUES.includes(value as DiscoveryMode);
}

export function normalizeDiscoveryMode(value: unknown): DiscoveryMode {
  return isDiscoveryMode(value) ? value : DEFAULT_DISCOVERY_MODE;
}

export function getDiscoveryModeConfig(
  mode: DiscoveryMode | null | undefined
): DiscoveryModeConfig {
  return DISCOVERY_MODE_CONFIGS[normalizeDiscoveryMode(mode)];
}

export function isDiscoveryModeEnabled(
  mode: DiscoveryMode | null | undefined
): boolean {
  return getDiscoveryModeConfig(mode).availability === 'enabled';
}

/**
 * Define se o modo de descoberta precisa de localização do navegador.
 *
 * Mantém o nome atual para compatibilidade com OnlineUsersComponent e demais
 * consumidores já existentes.
 */
export function discoveryModeRequiresLocation(mode: DiscoveryMode): boolean {
  return getDiscoveryModeConfig(mode).requiresLocation;
}

export function discoveryModeRequiresOnlinePresence(
  mode: DiscoveryMode | null | undefined
): boolean {
  return getDiscoveryModeConfig(mode).requiresOnlinePresence;
}
