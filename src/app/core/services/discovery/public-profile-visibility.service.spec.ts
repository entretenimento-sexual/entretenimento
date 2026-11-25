import { assertInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore, type DocumentReference, type DocumentSnapshot } from '@angular/fire/firestore';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PublicBilateralMediaAvailabilityService } from 'src/app/core/services/media/public-bilateral-media-availability.service';
import { PublicProfileReadBoundaryService } from './public-profile-read-boundary.service';
import {
  PUBLIC_PROFILE_VISIBILITY_FIRESTORE, PublicProfileVisibilityService,
  watchBilateralProfileVisibility$, watchPublicProfileMediaIndexWithRecovery$,
} from './public-profile-visibility.service';

describe('watchBilateralProfileVisibility$', () => {
  it('desmonta o perfil no bloqueio e cria nova assinatura após desbloqueio', () => {
    const bilateral$ = new Subject<boolean>();
    const first$ = new Subject<boolean>();
    const second$ = new Subject<boolean>();
    const watchOwner = vi.fn()
      .mockImplementationOnce(() => first$.asObservable())
      .mockImplementationOnce(() => second$.asObservable());
    const seen: boolean[] = [];
    const sub = watchBilateralProfileVisibility$(
      bilateral$, watchOwner
    ).subscribe((allowed) => seen.push(allowed));

    bilateral$.next(true);
    first$.next(true);
    expect(seen).toEqual([true]);
    bilateral$.next(false);
    expect(seen).toEqual([true, false]);
    expect(first$.observed).toBe(false);

    bilateral$.next(true);
    expect(watchOwner).toHaveBeenCalledTimes(2);
    second$.next(true);
    expect(seen).toEqual([true, false, true]);

    sub.unsubscribe();
  });

  it('não consulta a projeção pública quando o bloqueio está ativo', () => {
    const watchOwner = vi.fn(() => of(true));
    const received: boolean[] = [];
    const sub = watchBilateralProfileVisibility$(of(false), watchOwner)
      .subscribe((allowed) => received.push(allowed));
    expect(received).toEqual([false]);
    expect(watchOwner).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});

describe('watchPublicProfileMediaIndexWithRecovery$', () => {
  it('revoga no erro, reconecta após confirmação e observa novas revisões', () => {
    vi.useFakeTimers();
    const first$ = new Subject<{ available: boolean; mediaRevision: number }>();
    const restored$ = new Subject<{ available: boolean; mediaRevision: number }>();
    const probe$ = new Subject<boolean>();
    const watch = vi.fn()
      .mockReturnValueOnce(first$)
      .mockReturnValueOnce(restored$);
    const seen: Array<{ available: boolean; mediaRevision: number }> = [];
    const sub = watchPublicProfileMediaIndexWithRecovery$(
      watch, () => probe$
    ).subscribe(value => seen.push(value));
    try {
      first$.next({ available: true, mediaRevision: 3 });
      first$.error(new Error('permission-denied'));
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
      probe$.next(false);
      vi.advanceTimersByTime(15000);
      expect(watch).toHaveBeenCalledTimes(1);
      probe$.next(true);
      vi.advanceTimersByTime(15000);
      expect(watch).toHaveBeenCalledTimes(2);
      expect(seen.at(-1)?.available).toBe(false);
      restored$.next({ available: true, mediaRevision: 4 });
      restored$.next({ available: true, mediaRevision: 5 });
      expect(seen.at(-1)).toEqual({ available: true, mediaRevision: 5 });
    } finally {
      sub.unsubscribe();
      vi.useRealTimers();
    }
  });
});

describe('PublicProfileVisibilityService injection context', () => {
  it('creates each canonical listener in the injection context, including recovery', () => {
    vi.useFakeTimers();
    const first$ = new Subject<DocumentSnapshot>();
    const restored$ = new Subject<DocumentSnapshot>();
    const readByUids$ = vi.fn(() => of({ items: [{ uid: 'owner-1' }] }));
    const db = {};
    const firstRef = {} as DocumentReference;
    const restoredRef = {} as DocumentReference;
    const contextChecks: string[] = [];
    const createDocument = vi.fn((_db: Firestore, _path: string): DocumentReference => {
      assertInInjectionContext(createDocument);
      contextChecks.push('doc');
      return contextChecks.length === 1 ? firstRef : restoredRef;
    });
    const watchDocument = vi.fn((ref: DocumentReference) => {
      assertInInjectionContext(watchDocument);
      contextChecks.push('docSnapshots');
      return ref === firstRef ? first$ : restored$;
    });
    const snapshot = (revision: number, fromCache = false): DocumentSnapshot =>
      ({
        metadata: { fromCache, hasPendingWrites: false },
        exists: () => true,
        data: () => ({ publicMediaRevision: revision }),
      }) as unknown as DocumentSnapshot;

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: db },
        { provide: PUBLIC_PROFILE_VISIBILITY_FIRESTORE, useValue: {
          doc: createDocument, docSnapshots: watchDocument,
        } },
        { provide: AuthSessionService, useValue: { uid$: of('owner-1') } },
        { provide: PublicProfileReadBoundaryService, useValue: { readByUids$ } },
        { provide: PublicBilateralMediaAvailabilityService, useValue: {} },
      ],
    });
    const service = TestBed.inject(PublicProfileVisibilityService);
    const seen: Array<{ available: boolean; mediaRevision: number }> = [];
    // Deliberately subscribe outside TestBed.runInInjectionContext.
    const sub = service.watchMediaIndex$('owner-1').subscribe(value => seen.push(value));
    try {
      expect(contextChecks).toEqual(['doc', 'docSnapshots']);
      expect(first$.observed).toBe(true);
      expect(createDocument).toHaveBeenCalledWith(db, 'public_profiles/owner-1');
      expect(watchDocument).toHaveBeenCalledWith(firstRef);
      first$.next(snapshot(3));
      expect(seen.at(-1)).toEqual({ available: true, mediaRevision: 3 });
      first$.error(new Error('permission-denied'));
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
      expect(first$.observed).toBe(false);
      vi.advanceTimersByTime(15000);
      expect(readByUids$).toHaveBeenCalledWith(['owner-1']);
      expect(createDocument).toHaveBeenCalledTimes(2);
      expect(watchDocument).toHaveBeenCalledTimes(2);
      expect(watchDocument).toHaveBeenLastCalledWith(restoredRef);
      expect(contextChecks).toEqual(['doc', 'docSnapshots', 'doc', 'docSnapshots']);
      expect(restored$.observed).toBe(true);
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
      restored$.next(snapshot(4, true));
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
      restored$.next(snapshot(4));
      expect(seen.at(-1)).toEqual({ available: true, mediaRevision: 4 });
    } finally {
      sub.unsubscribe();
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
    expect(restored$.observed).toBe(false);
  });
});
