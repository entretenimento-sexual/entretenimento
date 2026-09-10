import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CommunityDiscoverySessionBehaviorService } from './community-discovery-session-behavior.service';

describe('CommunityDiscoverySessionBehaviorService', () => {
  function harness(initialUid: string | null = 'user-a') {
    const uidSubject = new BehaviorSubject<string | null>(initialUid);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthSessionService,
          useValue: {
            uid$: uidSubject.asObservable(),
          },
        },
      ],
    });

    return {
      behavior: TestBed.inject(CommunityDiscoverySessionBehaviorService),
      uidSubject,
    };
  }

  it('deduplica aberturas próximas e mantém o estado somente na sessão', async () => {
    const { behavior } = harness();

    behavior.recordMeaningfulOpen('community-a', 1_000_000);
    behavior.recordMeaningfulOpen('community-a', 1_001_000);
    behavior.recordMeaningfulOpen('community-a', 1_301_000);

    const state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.meaningfulOpenCount).toBe(2);
  });

  it('reflete membership ativa sem inferir tags ou preferências', async () => {
    const { behavior } = harness();

    behavior.setMembershipActive('community-a', true);
    let state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.memberActive).toBe(true);

    behavior.setMembershipActive('community-a', false);
    state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.signals['community-a']?.memberActive).toBe(false);
  });

  it('oculta e restaura uma Comunidade de forma reversível', async () => {
    const { behavior } = harness();

    behavior.hideCommunity('community-a');
    let state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual(['community-a']);

    behavior.restoreCommunity('community-a');
    state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual([]);
  });

  it('limpa sinais e ocultações imediatamente quando a sessão cai', async () => {
    const { behavior, uidSubject } = harness('user-a');

    behavior.recordMeaningfulOpen('community-a', 1_000_000);
    behavior.setMembershipActive('community-a', true);
    behavior.hideCommunity('community-b');

    uidSubject.next(null);

    const state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual([]);
    expect(state.signals).toEqual({});
  });

  it('não deixa estado comportamental atravessar troca direta de UID', async () => {
    const { behavior, uidSubject } = harness('user-a');

    behavior.recordMeaningfulOpen('community-a', 1_000_000);
    behavior.hideCommunity('community-b');

    uidSubject.next('user-b');

    const state = await firstValueFrom(behavior.state$.pipe(take(1)));
    expect(state.hiddenCommunityIds).toEqual([]);
    expect(state.signals).toEqual({});
  });
});
