import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { CommunityDiscoverySessionBehaviorService } from './community-discovery-session-behavior.service';

describe('CommunityDiscoverySessionBehaviorService', () => {
  function service(): CommunityDiscoverySessionBehaviorService {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.inject(CommunityDiscoverySessionBehaviorService);
  }

  it('deduplica aberturas próximas e mantém o estado somente na sessão', async () => {
    const behavior = service();

    behavior.recordMeaningfulOpen('community-a', 1_000_000);
    behavior.recordMeaningfulOpen('community-a', 1_001_000);
    behavior.recordMeaningfulOpen('community-a', 1_301_000);

    const state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.meaningfulOpenCount).toBe(2);
  });

  it('reflete membership ativa sem inferir tags ou preferências', async () => {
    const behavior = service();

    behavior.setMembershipActive('community-a', true);
    let state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.memberActive).toBe(true);

    behavior.setMembershipActive('community-a', false);
    state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.memberActive).toBe(false);
  });

  it('oculta e restaura uma Comunidade de forma reversível', async () => {
    const behavior = service();

    behavior.hideCommunity('community-a');
    let state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual(['community-a']);

    behavior.restoreCommunity('community-a');
    state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual([]);
  });
});
