// src/app/preferences/services/compatibility-preview.service.ts
// Serviço puro de cálculo de compatibilidade.
//
// Responsabilidade:
// - comparar dois MatchProfiles
// - gerar score agregado e razões legíveis
// - não conhece UI
// - não persiste nada

import { Injectable } from '@angular/core';

import { MatchProfile } from '../models/match-profile.model';
import {
  CompatibilityPreview,
  CompatibilityReason,
} from '../models/compatibility-preview.model';

@Injectable({ providedIn: 'root' })
export class CompatibilityPreviewService {
  compare(current: MatchProfile, target: MatchProfile): CompatibilityPreview {
    const intentScore = this.computeOverlapScore(
      current.search.relationshipIntents,
      target.search.relationshipIntents
    );

    const practiceScore = this.computeOverlapScore(
      current.search.sexualPractices,
      target.search.sexualPractices
    );

    const availabilityScore = this.computeAvailabilityScore(
      current.search.availableNow,
      target.search.availableNow
    );

    const discoveryModeScore = this.computeDiscoveryModeScore(
      current.search.discoveryMode,
      target.search.discoveryMode
    );

    const geographyScore = this.computeGeographyScore(
      current.search.city,
      current.search.state,
      target.search.city,
      target.search.state
    );

    const readinessScore = this.computeReadinessScore(current, target);

    const overallScore = Math.round(
      intentScore * 0.28 +
      practiceScore * 0.24 +
      availabilityScore * 0.14 +
      discoveryModeScore * 0.10 +
      geographyScore * 0.10 +
      readinessScore * 0.14
    );

    const reasons: CompatibilityReason[] = [
      {
        key: 'intent_overlap',
        label: 'Cruzamento de intenção',
        matched: intentScore >= 50,
        score: intentScore,
        description:
          intentScore >= 50
            ? 'Há alinhamento razoável entre as intenções relacionais.'
            : 'O alinhamento de intenção ainda é baixo.',
      },
      {
        key: 'practice_overlap',
        label: 'Cruzamento de práticas',
        matched: practiceScore >= 50,
        score: practiceScore,
        description:
          practiceScore >= 50
            ? 'Existem interesses práticos em comum.'
            : 'As práticas desejadas ainda têm pouca interseção.',
      },
      {
        key: 'availability',
        label: 'Disponibilidade contextual',
        matched: availabilityScore >= 60,
        score: availabilityScore,
        description:
          availabilityScore >= 60
            ? 'A disponibilidade atual favorece interação.'
            : 'A disponibilidade atual reduz a chance imediata de interação.',
      },
      {
        key: 'discovery_mode',
        label: 'Compatibilidade de descoberta',
        matched: discoveryModeScore >= 60,
        score: discoveryModeScore,
        description:
          discoveryModeScore >= 60
            ? 'Os modos de descoberta convivem bem.'
            : 'Os modos de descoberta sugerem ritmos diferentes de exposição.',
      },
      {
        key: 'geography',
        label: 'Proximidade geográfica',
        matched: geographyScore >= 60,
        score: geographyScore,
        description:
          geographyScore >= 60
            ? 'A geografia favorece descoberta e possível interação.'
            : 'A distância ou ausência de contexto geográfico reduz aderência.',
      },
      {
        key: 'readiness',
        label: 'Prontidão do perfil',
        matched: readinessScore >= 70,
        score: readinessScore,
        description:
          readinessScore >= 70
            ? 'Os dois perfis estão razoavelmente prontos para discovery.'
            : 'Ainda há sinais de prontidão baixos em um ou ambos os perfis.',
      },
    ];

    return {
      currentUid: current.userId,
      targetUid: target.userId,
      overallScore,
      intentScore,
      practiceScore,
      availabilityScore,
      discoveryModeScore,
      geographyScore,
      readinessScore,
      reasons,
      generatedAt: Date.now(),
    };
  }

  private computeOverlapScore(current: string[], target: string[]): number {
    const a = new Set((current ?? []).filter(Boolean));
    const b = new Set((target ?? []).filter(Boolean));

    if (a.size === 0 || b.size === 0) return 0;

    const intersection = [...a].filter((item) => b.has(item)).length;
    const union = new Set([...a, ...b]).size;

    if (union === 0) return 0;
    return Math.round((intersection / union) * 100);
  }

  private computeAvailabilityScore(currentAvailable: boolean, targetAvailable: boolean): number {
    if (currentAvailable && targetAvailable) return 100;
    if (currentAvailable || targetAvailable) return 60;
    return 25;
  }

  private computeDiscoveryModeScore(
    currentMode: MatchProfile['search']['discoveryMode'],
    targetMode: MatchProfile['search']['discoveryMode']
  ): number {
    if (currentMode === targetMode) {
      if (currentMode === 'priority') return 100;
      if (currentMode === 'discreet') return 85;
      return 75;
    }

    if (
      (currentMode === 'standard' && targetMode === 'discreet') ||
      (currentMode === 'discreet' && targetMode === 'standard')
    ) {
      return 60;
    }

    if (
      (currentMode === 'standard' && targetMode === 'priority') ||
      (currentMode === 'priority' && targetMode === 'standard')
    ) {
      return 70;
    }

    return 45;
  }

  private computeGeographyScore(
    currentCity: string | null,
    currentState: string | null,
    targetCity: string | null,
    targetState: string | null
  ): number {
    const cityA = (currentCity ?? '').trim().toLowerCase();
    const cityB = (targetCity ?? '').trim().toLowerCase();
    const stateA = (currentState ?? '').trim().toLowerCase();
    const stateB = (targetState ?? '').trim().toLowerCase();

    if (cityA && cityB && cityA === cityB) return 100;
    if (stateA && stateB && stateA === stateB) return 70;
    if (cityA || cityB || stateA || stateB) return 40;
    return 50;
  }

  private computeReadinessScore(current: MatchProfile, target: MatchProfile): number {
    const currentReady =
      Number(current.search.profileCompleted) +
      Number(current.search.emailVerified) +
      Number(current.search.isSubscriber);

    const targetReady =
      Number(target.search.profileCompleted) +
      Number(target.search.emailVerified) +
      Number(target.search.isSubscriber);

    return Math.round(((currentReady + targetReady) / 6) * 100);
  }
}