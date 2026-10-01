import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { filter } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { selectGlobalOnlineUsers } from 'src/app/store/selectors/selectors.user/online.selectors';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { DiscoveryCardEnrichmentService } from '../../../discovery/application/discovery-card-enrichment.service';
import { OnlineUsersLocationFacade } from './online-users-location.facade';
import { OnlineUsersFeedFacade } from './online-users-feed.facade';

describe('OnlineUsersFeedFacade', () => {
  function setup(input?: {
    currentUser?: any | null;
    users?: any[];
    buildError?: unknown;
  }) {
    const currentUser =
      input?.currentUser === undefined
        ? {
            uid: 'me',
            emailVerified: true,
            role: 'premium',
            profileCompleted: true,
          }
        : input.currentUser;
    const users = input?.users ?? [
      {
        uid: 'other',
        nickname: 'Pessoa',
      },
    ];

    const select = vi.fn((selector: any) => {
      if (selector === selectCurrentUser) {
        return of(currentUser);
      }
      if (selector === selectGlobalOnlineUsers) {
        return of(users);
      }
      return of(null);
    });

    const location = signal<any>({
      latitude: -22.9,
      longitude: -43.2,
    });
    const distance$ = new BehaviorSubject<number | null>(12);
    const normalizeDistanceCap = vi.fn(() => 12);
    const buildCards = vi.fn(() => {
      if (input?.buildError) {
        throw input.buildError;
      }

      return [
        {
          uid: 'other',
          distanciaKm: 3,
        },
      ];
    });
    const report = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OnlineUsersFeedFacade,
        {
          provide: Store,
          useValue: { select },
        },
        {
          provide: DiscoveryCardEnrichmentService,
          useValue: { buildCards },
        },
        {
          provide: OnlineUsersLocationFacade,
          useValue: {
            location,
            distance$,
            uiDistanceKm: signal<number | undefined>(12),
            policyMaxDistanceKm: signal(20),
            normalizeDistanceCap,
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
      ],
    });

    return {
      facade: TestBed.inject(OnlineUsersFeedFacade),
      buildCards,
      normalizeDistanceCap,
      report,
      location,
      distance$,
    };
  }

  it('enriquece os perfis com modo, raio e localização atuais', async () => {
    const {
      facade,
      buildCards,
      normalizeDistanceCap,
    } = setup();

    const users = await firstValueFrom(
      facade
        .observe$(of('nearby'))
        .pipe(filter((items) => items.length > 0))
    );

    expect(users).toEqual([
      {
        uid: 'other',
        distanciaKm: 3,
      },
    ]);
    expect(normalizeDistanceCap).toHaveBeenCalledWith(12);
    expect(buildCards).toHaveBeenCalledWith({
      profiles: [
        {
          uid: 'other',
          nickname: 'Pessoa',
        },
      ],
      currentUser: expect.objectContaining({ uid: 'me' }),
      currentUid: 'me',
      mode: 'nearby',
      capKm: 12,
      fallbackLocation: {
        latitude: -22.9,
        longitude: -43.2,
      },
      applyVisibility: true,
    });
  });

  it('reage a mudança de distância sem recriar estado no componente', async () => {
    const { facade, buildCards, distance$ } = setup();

    const emissions: unknown[] = [];
    const subscription = facade
      .observe$(of('nearby'))
      .subscribe((items) => {
        if (items.length) {
          emissions.push(items);
        }
      });

    distance$.next(18);

    expect(buildCards).toHaveBeenCalled();
    expect(emissions.length).toBeGreaterThan(0);

    subscription.unsubscribe();
  });

  it('não enriquece sem usuário atual resolvido', async () => {
    const { facade, buildCards } = setup({
      currentUser: null,
    });

    await expect(
      firstValueFrom(facade.observe$(of('all')))
    ).resolves.toEqual([]);

    expect(buildCards).not.toHaveBeenCalled();
  });

  it('falha fechado e diagnostica erro do enrichment', async () => {
    const error = new Error('enrichment failed');
    const { facade, report } = setup({
      buildError: error,
    });

    const values: unknown[] = [];
    const subscription = facade.observe$(of('all')).subscribe((value) => {
      values.push(value);
    });

    expect(values).toContainEqual([]);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'online-users',
      operation: 'OnlineUsersFeedFacade.observe',
      fallbackMessage:
        'Não foi possível atualizar os perfis disponíveis.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'OnlineUsersFeedFacade',
      },
    });

    subscription.unsubscribe();
  });

  it('deriva contador da lista enriquecida', async () => {
    const { facade } = setup();

    await expect(
      firstValueFrom(
        facade
          .count$(of([{ uid: '1' }, { uid: '2' }] as any))
          .pipe(filter((count) => count > 0))
      )
    ).resolves.toBe(2);
  });
});
