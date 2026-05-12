// src/app/dashboard/discovery/models/discovery-mode.model.ts
// -----------------------------------------------------------------------------
// DiscoveryMode model
// -----------------------------------------------------------------------------
//
// Modelo simples dos modos de descoberta da área /dashboard/explorar.
//
// Mantido separado para:
// - evitar string solta em vários componentes;
// - permitir evolução futura para permissões, filtros e analytics;
// - manter DiscoveryModeTabsComponent puramente visual.
export type DiscoveryMode =
  | 'online'
  | 'all'
  | 'nearby'
  | 'compatible'
  | 'new';

export interface DiscoveryTab {
  mode: DiscoveryMode;
  label: string;
  icon: string;
  enabled: boolean;
  description: string;
}