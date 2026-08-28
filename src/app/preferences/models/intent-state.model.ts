// src/app/preferences/models/intent-state.model.ts
// Estado contextual/temporário do desejo do usuário.
// Aqui entra "o que quero agora", separado das preferências estáveis.
import { IntentMode } from './preference.types';

export interface IntentState {
  userId: string;

  mode: IntentMode;
  availableNow: boolean;
  availableToday: boolean;

  tags: string[];

  cityOverride: string | null;
  expiresAt: number | null;

  updatedAt: number;
}