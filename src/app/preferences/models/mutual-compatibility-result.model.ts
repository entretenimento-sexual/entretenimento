// src/app/preferences/models/mutual-compatibility-result.model.ts
// Resultado bidirecional entre dois MatchProfiles.
// Este é o shape certo para "mão dupla".
import { CompatibilityPreview } from './compatibility-preview.model';

export interface MutualCompatibilityResult {
  currentUid: string;
  targetUid: string;

  currentToTarget: CompatibilityPreview;
  targetToCurrent: CompatibilityPreview;

  currentToTargetScore: number;
  targetToCurrentScore: number;
  mutualScore: number;

  reciprocalIntentMatch: boolean;
  reciprocalPracticeMatch: boolean;
  reciprocalAvailabilityMatch: boolean;
  reciprocalDiscoveryFit: boolean;

  interactionAllowed: boolean;
  reasons: string[];

  generatedAt: number;
}