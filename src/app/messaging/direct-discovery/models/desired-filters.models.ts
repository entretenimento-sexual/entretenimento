// src\app\messaging\direct-discovery\models\desired-filters.models.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
// Lembrar das imposições de restrições de participação em chats e mensagens
import { DesiredProfileKind } from './desired-profile.models';

export interface DesiredFilters {
  wantedKinds: DesiredProfileKind[];
  onlyOnline: boolean;
  region?: string | null;
}

export const DEFAULT_DESIRED_FILTERS: DesiredFilters = {
  wantedKinds: [],
  onlyOnline: false,
  region: null,
};
