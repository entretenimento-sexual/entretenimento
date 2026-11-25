import { Observable, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { assertInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Firestore, type DocumentReference, type DocumentSnapshot } from '@angular/fire/firestore';
import { PublicProfileVisibilityService } from 'src/app/core/services/discovery/public-profile-visibility.service';
import {
  PUBLIC_MEDIA_EXPOSURE_FIRESTORE, PublicVideoPlaybackExposureService,
  watchMediaAfterProfileAvailability$,
} from './public-video-playback-exposure.service';

describe('watchMediaAfterProfileAvailability$', () => {
  it('encerra listener na exclusão e readquire permissão após cancelamento', () => {
    const allowed$ = new Subject<boolean>();
    const firstMedia$ = new Subject<boolean>();
    const restoredMedia$ = new Subject<boolean>();
    const watchMedia = vi.fn()
      .mockImplementationOnce(() => firstMedia$.asObservable())
      .mockImplementationOnce(() => restoredMedia$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      allowed$, watchMedia
    ).subscribe(value => seen.push(value));

    allowed$.next(true);
    firstMedia$.next(true);
    expect(seen).toEqual([true]);

    allowed$.next(false);
    expect(seen).toEqual([true, false]);
    expect(firstMedia$.observed).toBe(false);

    // Mesmo que a escuta anterior tenha morrido com permission-denied,
    // a restauração exige uma NOVA subscrição para a mídia atual.
    allowed$.next(true);
    expect(watchMedia).toHaveBeenCalledTimes(2);
    restoredMedia$.next(true);
    expect(seen).toEqual([true, false, true]);
    subscription.unsubscribe();
  });

  it('nunca consulta mídia quando o perfil está indisponível', () => {
    const watchMedia = vi.fn(() => of(true));
    const seen: boolean[] = [];
    watchMediaAfterProfileAvailability$(of(false), watchMedia)
      .subscribe(value => seen.push(value));
    expect(seen).toEqual([false]);
    expect(watchMedia).not.toHaveBeenCalled();
  });

  it('permanece fail-closed quando nova leitura da mídia é negada', () => {
    const denied$ = new Observable<boolean>(subscriber =>
      subscriber.error(new Error('permission-denied'))
    );
    const seen: boolean[] = [];
    watchMediaAfterProfileAvailability$(of(true), () => denied$)
      .subscribe(value => seen.push(value));
    expect(seen).toEqual([false]);
  });

  it('recupera depois de permission-denied do listener anterior', () => {
    const profile$ = new Subject<boolean>();
    const broken$ = new Subject<boolean>();
    const restored$ = new Subject<boolean>();
    const observe = vi.fn()
      .mockImplementationOnce(() => broken$.asObservable())
      .mockImplementationOnce(() => restored$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      profile$, observe
    ).subscribe((allowed) => seen.push(allowed));

    profile$.next(true);
    broken$.error({ code: 'permission-denied' });
    expect(seen).toEqual([false]);

    profile$.next(false);
    profile$.next(true);
    expect(observe).toHaveBeenCalledTimes(2);
    restored$.next(true);
    expect(seen).toEqual([false, true]);
    subscription.unsubscribe();
  });

  it('não reautoriza a partir de um resultado anterior após novo bloqueio', () => {
    const profile$ = new Subject<boolean>();
    const first$ = new Subject<boolean>();
    const second$ = new Subject<boolean>();
    const observe = vi.fn()
      .mockImplementationOnce(() => first$.asObservable())
      .mockImplementationOnce(() => second$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      profile$, observe
    ).subscribe(v => seen.push(v));

    profile$.next(true);
    first$.next(true);
    profile$.next(false);
    first$.next(true);
    expect(seen).toEqual([true, false]);

    profile$.next(true);
    second$.next(false); // mídia em quarentena/excluída
    expect(seen).toEqual([true, false]);
    expect(observe).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });
});


describe('PublicVideoPlaybackExposureService injection context', () => {
  it('recria a escuta de mídia no contexto em cada liberação do perfil', () => {
    const profile$ = new Subject<boolean>();
    const first$ = new Subject<DocumentSnapshot>();
    const restored$ = new Subject<DocumentSnapshot>();
    const ref = {} as DocumentReference;
    const createDocument = vi.fn((_db: Firestore, _path: string) => {
      assertInInjectionContext(createDocument);
      return ref;
    });
    const watchDocument = vi.fn((_ref: DocumentReference) => {
      assertInInjectionContext(watchDocument);
      return first$;
    }).mockImplementationOnce(() => {
      assertInInjectionContext(watchDocument);
      return first$;
    }).mockImplementationOnce(() => {
      assertInInjectionContext(watchDocument);
      return restored$;
    });
    const snapshot = (fromCache: boolean) => ({
      metadata: { fromCache, hasPendingWrites: false },
      exists: () => true,
      data: () => ({ visibility: 'PUBLIC', moderationStatus: 'APPROVED' }),
    }) as unknown as DocumentSnapshot;
    const db = {};
    TestBed.configureTestingModule({ providers: [
      { provide: Firestore, useValue: db },
      { provide: PUBLIC_MEDIA_EXPOSURE_FIRESTORE, useValue: {
        doc: createDocument, docSnapshots: watchDocument,
      } },
      { provide: PublicProfileVisibilityService, useValue: { watch$: () => profile$ } },
    ] });
    const service = TestBed.inject(PublicVideoPlaybackExposureService);
    const seen: boolean[] = [];
    const sub = service.watchActiveVideo$('owner', 'video', 'viewer').subscribe(value => seen.push(value));
    try {
      profile$.next(false);
      expect(createDocument).not.toHaveBeenCalled();
      profile$.next(true);
      expect(createDocument).toHaveBeenCalledWith(db, 'public_profiles/owner/public_videos/video');
      expect(first$.observed).toBe(true);
      first$.next(snapshot(false));
      expect(seen).toEqual([false, true]);
      profile$.next(false);
      expect(first$.observed).toBe(false);
      expect(seen).toEqual([false, true, false]);
      profile$.next(true);
      expect(createDocument).toHaveBeenCalledTimes(2);
      expect(watchDocument).toHaveBeenCalledTimes(2);
      expect(restored$.observed).toBe(true);
      restored$.next(snapshot(true));
      expect(seen.at(-1)).toBe(false);
      restored$.next(snapshot(false));
      expect(seen.at(-1)).toBe(true);
    } finally {
      sub.unsubscribe();
      TestBed.resetTestingModule();
    }
    expect(restored$.observed).toBe(false);
  });
});
