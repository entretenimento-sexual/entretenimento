// src/app/core/services/presence/presence.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PresenceService } from './presence.service';
import { PresenceDomStreamsService } from './presence-dom-streams.service';
import { PresenceLeaderElectionService } from './presence-leader-election.service';
import { PresenceWriterService } from './presence-writer.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';

describe('PresenceService', () => {
  let service: PresenceService;

  let storage$: Subject<StorageEvent>;
  let visibility$: Subject<'hidden' | 'visible'>;
  let online$: Subject<Event>;
  let offline$: Subject<Event>;
  let beforeUnload$: Subject<Event>;
  let pageHide$: Subject<Event>;
  let isLeader$: Subject<boolean>;

  let writerMock: {
    setOnline$: ReturnType<typeof vi.fn>;
    setAway$: ReturnType<typeof vi.fn>;
    beatOnline$: ReturnType<typeof vi.fn>;
    setOffline$: ReturnType<typeof vi.fn>;
  };

  let leaderMock: {
    buildLeaderKey: ReturnType<typeof vi.fn>;
    createIsLeader$: ReturnType<typeof vi.fn>;
    isLeaderNow: ReturnType<typeof vi.fn>;
    releaseLeadership: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();

    storage$ = new Subject<StorageEvent>();
    visibility$ = new Subject<'hidden' | 'visible'>();
    online$ = new Subject<Event>();
    offline$ = new Subject<Event>();
    beforeUnload$ = new Subject<Event>();
    pageHide$ = new Subject<Event>();
    isLeader$ = new Subject<boolean>();

    writerMock = {
      setOnline$: vi.fn(() => of(void 0)),
      setAway$: vi.fn(() => of(void 0)),
      beatOnline$: vi.fn(() => of(void 0)),
      setOffline$: vi.fn(() => of(void 0)),
    };

    leaderMock = {
      buildLeaderKey: vi.fn((uid: string) => `presence:${uid}`),
      createIsLeader$: vi.fn(() => isLeader$.asObservable()),
      isLeaderNow: vi.fn(() => true),
      releaseLeadership: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        PresenceService,
        {
          provide: NgZone,
          useValue: {
            runOutsideAngular: (task: () => void) => task(),
            run: <T>(task: () => T) => task(),
          },
        },
        {
          provide: PresenceDomStreamsService,
          useValue: {
            create: () => ({
              storage$: storage$.asObservable(),
              visibility$: visibility$.asObservable(),
              online$: online$.asObservable(),
              offline$: offline$.asObservable(),
              beforeUnload$: beforeUnload$.asObservable(),
              pageHide$: pageHide$.asObservable(),
            }),
          },
        },
        {
          provide: PresenceLeaderElectionService,
          useValue: leaderMock,
        },
        {
          provide: PresenceWriterService,
          useValue: writerMock,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(PresenceService);
  });

  afterEach(() => {
    try {
      service.stop();
    } catch {}
    vi.useRealTimers();
  });

  it('inicia presença para uid válido e escreve estado inicial quando é líder', () => {
    service.start('u1');
    isLeader$.next(true);

    expect(leaderMock.buildLeaderKey).toHaveBeenCalledWith('u1');
    expect(writerMock.setOnline$).toHaveBeenCalledWith('u1');
  });

  it('agenda heartbeats a cada 30s quando a aba é líder e está visível', () => {
    service.start('u1');
    isLeader$.next(true);
    writerMock.beatOnline$.mockClear();

    vi.advanceTimersByTime(29_000);
    expect(writerMock.beatOnline$).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(writerMock.beatOnline$).toHaveBeenCalledWith('u1');
  });

  it('marca away quando o navegador informa offline', () => {
    service.start('u1');
    isLeader$.next(true);
    writerMock.setAway$.mockClear();

    offline$.next(new Event('offline'));
    vi.advanceTimersByTime(1_000);

    expect(writerMock.setAway$).toHaveBeenCalledWith('u1');
  });

  it('marca away quando a aba fica hidden', () => {
    service.start('u1');
    isLeader$.next(true);
    writerMock.setAway$.mockClear();

    visibility$.next('hidden');

    expect(writerMock.setAway$).toHaveBeenCalledWith('u1');
  });

  it('stop() limpa streams, marca offline e libera liderança', () => {
    service.start('u1');
    isLeader$.next(true);

    writerMock.setOffline$.mockClear();
    leaderMock.releaseLeadership.mockClear();

    service.stop();

    expect(writerMock.setOffline$).toHaveBeenCalledWith('u1', 'stop$()');
    expect(leaderMock.releaseLeadership).toHaveBeenCalledWith('presence:u1');

    writerMock.beatOnline$.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(writerMock.beatOnline$).not.toHaveBeenCalled();
  });
});
