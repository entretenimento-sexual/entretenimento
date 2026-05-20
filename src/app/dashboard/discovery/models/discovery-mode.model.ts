// src/app/dashboard/discovery/models/discovery-mode.model.ts
// -----------------------------------------------------------------------------
// DiscoveryModeModel
// -----------------------------------------------------------------------------
//
// Modelo central dos modos de descoberta.
//
// Objetivo:
// - evitar strings soltas em componentes;
// - padronizar "Todos" como modo padrão;
// - permitir evolução gradual para região, recentes, bombando e compatíveis;
// - manter modos futuros visíveis, mas desabilitados enquanto a lógica real
//   ainda não estiver implementada.
//
// Observação de produto:
// - "Todos" NÃO deve significar lista crua.
// - "Todos" será o feed geral refinado: perfis exibíveis, priorizando online,
//   compatibilidade, região/distância quando disponível e qualidade do perfil.
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

export interface DiscoveryModeTab {
  id: DiscoveryMode;
  label: string;
  shortLabel?: string;
  icon: string;
  ariaLabel: string;
  disabled?: boolean;
  badge?: string;

  /**
   * Texto curto usado como tooltip acessível.
   *
   * Deve explicar o comportamento real do filtro sem poluir visualmente a tela.
   */
  description?: string;
}

/**
 * Default recomendado:
 * - "Todos" como entrada principal da descoberta;
 * - não exige localização;
 * - depois será refinado por ranking.
 */
export const DEFAULT_DISCOVERY_MODE: DiscoveryMode = 'all';

export const DISCOVERY_MODE_TABS: readonly DiscoveryModeTab[] = [
  {
    id: 'all',
    label: 'Todos',
    icon: 'fas fa-users',
    ariaLabel: 'Ver todos os perfis recomendados',
    description:
    'Mostra perfis públicos disponíveis para descoberta.' +
    'Não é uma lista bruta: online, distância, região, atualização recente e compatibilidade.',
  },
  {
    id: 'online',
    label: 'Online',
    icon: 'fas fa-bolt',
    ariaLabel: 'Ver perfis online agora',
  },
  {
    id: 'nearby',
    label: 'Perto',
    icon: 'fas fa-location-dot',
    ariaLabel: 'Ver perfis próximos',
    disabled: true,
    badge: 'em breve',
  },
  {
    id: 'region',
    label: 'Região',
    icon: 'fas fa-map-location-dot',
    ariaLabel: 'Ver perfis por região',
    disabled: true,
    badge: 'em breve',
  },
  {
    id: 'recent',
    label: 'Recentes',
    icon: 'fas fa-clock',
    ariaLabel: 'Ver perfis atualizados recentemente',
    disabled: true,
    badge: 'em breve',
  },
  {
    id: 'trending',
    label: 'Bombando',
    icon: 'fas fa-fire',
    ariaLabel: 'Ver perfis em destaque',
    disabled: true,
    badge: 'em breve',
  },
  {
    id: 'compatible',
    label: 'Compatíveis',
    icon: 'fas fa-heart',
    ariaLabel: 'Ver perfis compatíveis',
    disabled: true,
    badge: 'em breve',
  },
] as const;

export function isDiscoveryMode(value: unknown): value is DiscoveryMode {
  return DISCOVERY_MODE_VALUES.includes(value as DiscoveryMode);
}

export function normalizeDiscoveryMode(value: unknown): DiscoveryMode {
  return isDiscoveryMode(value) ? value : DEFAULT_DISCOVERY_MODE;
}

/**
 * Define se o modo de descoberta precisa de localização do navegador.
 *
 * Regra importante:
 * - "Todos" não exige localização.
 * - "Online" não exige localização.
 * - "Perto" exige localização.
 * - "Região" futuramente pode usar estado/município do perfil, não GPS.
 *
 * Isso evita que a plataforma peça localização em todo refresh quando o usuário
 * está apenas navegando pelo feed geral.
 */
export function discoveryModeRequiresLocation(mode: DiscoveryMode): boolean {
  switch (mode) {
    case 'nearby':
      return true;

    case 'all':
    case 'online':
    case 'region':
    case 'recent':
    case 'trending':
    case 'compatible':
    default:
      return false;
  }
}