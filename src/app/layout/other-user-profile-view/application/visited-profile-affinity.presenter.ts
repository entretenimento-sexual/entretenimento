import { Injectable } from '@angular/core';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  resolvePublicPreferenceLabel,
} from 'src/app/core/catalogs/public-preference-options.catalog';
import {
  evaluateDiscoveryCandidatePreference,
} from 'src/app/core/utils/discovery/profile-type-preference-filter.util';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

export interface VisitedProfileAffinityVm {
  preferenceChips: readonly string[];
  desireMatch: {
    title: string;
    labels: readonly string[];
  } | null;
}

@Injectable()
export class VisitedProfileAffinityPresenter {
  constructor(
    private readonly currentUserStore: CurrentUserStoreService
  ) {}

  build(target: IUserDados | null): VisitedProfileAffinityVm {
    return {
      preferenceChips: this.buildPreferenceChips(target),
      desireMatch: this.buildDesireMatch(target),
    };
  }

  private buildPreferenceChips(
    profile: IUserDados | null
  ): readonly string[] {
    if (!profile || profile.preferenceBadgesVisible !== true) {
      return [];
    }

    const labels: string[] = [];
    const append = (
      kind: 'relationship' | 'body_trait' | 'sexual_practice',
      values: readonly string[] | null | undefined
    ): void => {
      for (const value of values ?? []) {
        const label = resolvePublicPreferenceLabel(kind, value);
        if (!label || labels.includes(label)) {
          continue;
        }

        labels.push(label);

        if (labels.length >= 8) {
          return;
        }
      }
    };

    append('relationship', profile.publicRelationshipIntents);

    if (labels.length < 8) {
      append('body_trait', profile.publicBodyTraits);
    }

    if (labels.length < 8) {
      append('sexual_practice', profile.publicSexualPractices);
    }

    return labels.slice(0, 8);
  }

  private buildDesireMatch(
    target: IUserDados | null
  ): VisitedProfileAffinityVm['desireMatch'] {
    const viewer = this.currentUserStore.getSnapshot();

    if (!viewer?.uid || !target?.uid || viewer.uid === target.uid) {
      return null;
    }

    const result = evaluateDiscoveryCandidatePreference(viewer, target);

    if (!result.accepted || result.matchedSignals.length === 0) {
      return null;
    }

    const labels: string[] = [];

    for (const signal of result.matchedSignals) {
      switch (signal) {
        case 'relationship_intent':
          labels.push('Intenção');
          break;
        case 'sexual_practice':
          labels.push('Práticas');
          break;
        case 'body_trait':
          labels.push('Características');
          break;
      }
    }

    if (!labels.length) {
      return null;
    }

    return {
      title:
        result.preferenceScore >= 0.75
          ? 'Desejos bem alinhados'
          : 'Desejos em comum',
      labels,
    };
  }
}
