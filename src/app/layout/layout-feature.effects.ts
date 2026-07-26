// Effects carregados somente com o LayoutModule lazy.
import { NearbyProfilesEffects } from '../store/effects/effects.location/nearby-profiles.effects';

/**
 * Registro lazy do fluxo legado de perfis próximos.
 *
 * O effect permanece disponível para PerfisProximosComponent, mas sua cadeia
 * de geolocalização não faz mais parte do bootstrap global da aplicação.
 */
export const LAYOUT_FEATURE_EFFECTS = [NearbyProfilesEffects];
