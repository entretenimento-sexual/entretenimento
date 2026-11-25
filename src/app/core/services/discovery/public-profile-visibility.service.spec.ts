import { assertInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PublicBilateralMediaAvailabilityService } from 'src/app/core/services/media/public-bilateral-media-availability.service';
import { PublicProfileReadBoundaryService } from './public-profile-read-boundary.service';
import { PublicProfileVisibilityService, watchBilateralProfileVisibility$, watchPublicProfileMediaIndexWithRecovery$ } from './public-profile-visibility.service';

vi.mock('@angular/fire/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@angular/fire/firestore')>(),
  doc: vi.fn(),
  docSnapshots: vi.fn(),
}));

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
    const first$ = new Subject<never>();
    const restored$ = new Subject<never>();
    const readByUids$ = vi.fn(() => of({ items: [{ uid: 'owner-1' }] }));
    vi.mocked(doc).mockImplementation(() => {
      assertInInjectionContext(doc);
      return {} as ReturnType<typeof doc>;
    });
    vi.mocked(docSnapshots)
      .mockImplementationOnce(() => {
        assertInInjectionContext(docSnapshots);
        return first$;
      })
      .mockImplementationOnce(() => {
        assertInInjectionContext(docSnapshots);
        return restored$;
      });

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: AuthSessionService, useValue: { uid$: of('owner-1') } },
        { provide: PublicProfileReadBoundaryService, useValue: { readByUids$ } },
        { provide: PublicBilateralMediaAvailabilityService, useValue: {} },
      ],
    });
    const service = TestBed.inject(PublicProfileVisibilityService);
    const seen: Array<{ available: boolean; mediaRevision: number }> = [];
    const sub = service.watchMediaIndex$('owner-1').subscribe(value => seen.push(value));
    try {
      expect(first$.observed).toBe(true);
      first$.error(new Error('permission-denied'));
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
      vi.advanceTimersByTime(15000);
      expect(readByUids$).toHaveBeenCalledWith(['owner-1']);
      expect(doc).toHaveBeenCalledTimes(2);
      expect(docSnapshots).toHaveBeenCalledTimes(2);
      expect(restored$.observed).toBe(true);
      expect(seen.at(-1)).toEqual({ available: false, mediaRevision: 0 });
    } finally {
      sub.unsubscribe();
      TestBed.resetTestingModule();
      vi.mocked(doc).mockReset();
      vi.mocked(docSnapshots).mockReset();
      vi.useRealTimers();
    }
    expect(restored$.observed).toBe(false);
  });
});
