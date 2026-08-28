// Effects carregados somente com o DashboardModule lazy.
import { DiscoveryFeedEffects } from '../store/effects/effects.discovery/discovery-feed.effects';

/**
 * Registro lazy dos fluxos exclusivos do dashboard.
 *
 * DiscoveryFeedEffects permanece disponível para a descoberta paginada, mas o
 * repositório de perfis públicos deixa de fazer parte do bootstrap global.
 */
export const DASHBOARD_FEATURE_EFFECTS = [DiscoveryFeedEffects];
