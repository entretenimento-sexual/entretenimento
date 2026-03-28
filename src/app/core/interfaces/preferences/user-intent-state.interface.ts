// src/app/core/interfaces/preferences/user-intent-state.interface.ts
// Não esquecer comentários explicativos e cosiderar sempre o role do usuário
import { TCurrentIntentMode } from './user-preference-enums';

export interface IUserIntentState {
  userId: string;

  currentMode: TCurrentIntentMode;
  availableNow: boolean;
  availableToday: boolean;

  contextTags: string[];

  cityOverride?: string | null;
  expiresAt?: number | null;

  updatedAt: number;
}