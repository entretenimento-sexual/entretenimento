// src\app\messaging\direct-discovery\services\desired-profile-matching.service.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
// Lembrar das imposições de restrições de participação em chats e mensagens
import { Injectable } from '@angular/core';
import { DesiredFilters } from '../models/desired-filters.models';
import { DesiredProfile, DesiredProfileKind } from '../models/desired-profile.models';

@Injectable({ providedIn: 'root' })
export class DesiredProfileMatchingService {
  filterAndRank(
    profiles: DesiredProfile[],
    filters: DesiredFilters
  ): DesiredProfile[] {
    return (profiles ?? [])
      .filter((profile) => this.matches(profile, filters))
      .map((profile) => ({
        ...profile,
        score: this.score(profile, filters),
      }))
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  }

  matches(profile: DesiredProfile, filters: DesiredFilters): boolean {
    if (!profile?.uid) return false;

    if (filters.onlyOnline && profile.online !== true) {
      return false;
    }

    if (filters.region && profile.region && profile.region !== filters.region) {
      return false;
    }

    if (filters.wantedKinds?.length) {
      const matchesWantedKind = this.intersects(
        profile.profileKinds,
        filters.wantedKinds
      );

      if (!matchesWantedKind) {
        return false;
      }
    }

    return true;
  }

  score(profile: DesiredProfile, filters: DesiredFilters): number {
    let score = 0;

    if (profile.online) score += 20;

    if (filters.region && profile.region === filters.region) {
      score += 10;
    }

    if (filters.wantedKinds?.length) {
      const overlap = this.countIntersections(profile.profileKinds, filters.wantedKinds);
      score += overlap * 15;
    }

    return score;
  }

  private intersects(
    a: DesiredProfileKind[] = [],
    b: DesiredProfileKind[] = []
  ): boolean {
    return a.some((item) => b.includes(item));
  }

  private countIntersections(
    a: DesiredProfileKind[] = [],
    b: DesiredProfileKind[] = []
  ): number {
    return a.filter((item) => b.includes(item)).length;
  }
}
