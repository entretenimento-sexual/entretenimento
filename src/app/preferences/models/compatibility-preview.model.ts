// src/app/preferences/models/compatibility-preview.model.ts
// Modelo de prévia de compatibilidade entre dois match profiles.
//
// Objetivo:
// - explicar score e motivos do cruzamento
// - servir de base para discovery, recomendações e futura monetização
// - manter estrutura clara para UI e debug
export interface CompatibilityReason {
  key:
    | 'intent_overlap'
    | 'practice_overlap'
    | 'availability'
    | 'discovery_mode'
    | 'geography'
    | 'readiness';

  label: string;
  matched: boolean;
  score: number;
  description: string;
}

export interface CompatibilityPreview {
  currentUid: string;
  targetUid: string;

  overallScore: number;

  intentScore: number;
  practiceScore: number;
  availabilityScore: number;
  discoveryModeScore: number;
  geographyScore: number;
  readinessScore: number;

  reasons: CompatibilityReason[];

  generatedAt: number;
}