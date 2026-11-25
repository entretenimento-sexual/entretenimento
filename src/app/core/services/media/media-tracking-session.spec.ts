import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import type { User } from 'firebase/auth';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PhotoViewTrackingService } from './photo-view-tracking.service';
import { VideoViewTrackingService } from './video-view-tracking.service';

function setup() {
  const user = (uid: string) => ({ uid }) as User;
  const uid$ = new BehaviorSubject<string | null>('a');
  const session = {
    uid$, currentAuthUser: user('a') as User | null,
    terminationVersionSnapshot: 0, isTerminatingSnapshot: false,
  };
  const requests: Subject<unknown>[] = [];
  const transport = vi.fn(() => {
    const response$ = new Subject<unknown>();
    requests.push(response$);
    return response$;
  });
  const report = vi.fn();
  TestBed.configureTestingModule({ providers: [
    { provide: Functions, useValue: {} },
    { provide: AuthSessionService, useValue: session },
    { provide: FirestoreContextService, useValue: { deferPromise$: transport } },
    { provide: MediaApplicationErrorService, useValue: { reportSilently: report } },
  ] });
  const change = (uid: string) => {
    session.currentAuthUser = user(uid);
    uid$.next(uid);
  };
  return { session, requests, transport, report, change };
}

afterEach(() => TestBed.resetTestingModule());

describe('media tracking session isolation', () => {
  it('cancela foto antiga e não suprime a visualização da nova conta', () => {
    const { requests, transport, change } = setup();
    const service = TestBed.inject(PhotoViewTrackingService);
    const first = service.recordPhotoView$('owner', 'photo');
    const old = first.subscribe();
    expect(transport).toHaveBeenCalledTimes(1);
    change('b');
    expect(old.closed).toBe(true);
    first.subscribe();
    expect(transport).toHaveBeenCalledTimes(1);
    service.recordPhotoView$('owner', 'photo').subscribe();
    requests[0].next(undefined);
    requests[0].complete();
    service.recordPhotoView$('owner', 'photo').subscribe();
    expect(transport).toHaveBeenCalledTimes(2);
    requests[1].next(undefined);
    requests[1].complete();
    service.recordPhotoView$('owner', 'photo').subscribe();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('ignora erro tardio e não remove request da nova instância com mesmo UID', () => {
    const { requests, transport, report, change } = setup();
    const service = TestBed.inject(PhotoViewTrackingService);
    const old = service.recordPhotoView$('owner', 'photo').subscribe();
    change('a');
    service.recordPhotoView$('owner', 'photo').subscribe();
    requests[0].error(new Error('stale'));
    expect(old.closed).toBe(true);
    expect(report).not.toHaveBeenCalled();
    service.recordPhotoView$('owner', 'photo').subscribe();
    expect(transport).toHaveBeenCalledTimes(2);
    requests[1].complete();
  });

  it('não reaproveita token de reprodução após troca de conta', () => {
    const { requests, transport, change } = setup();
    const service = TestBed.inject(VideoViewTrackingService);
    const old = service.prepareVideoViewSession$('owner', 'video').subscribe();
    change('b');
    expect(old.closed).toBe(true);
    service.prepareVideoViewSession$('owner', 'video').subscribe();
    requests[0].next({
      ownerUid: 'owner', videoId: 'video', playbackToken: 'x'.repeat(40),
      issuedAt: Date.now(), earliestQualifiedAt: Date.now() + 1000,
      expiresAt: Date.now() + 120000, requiredPlaybackMs: 1000,
    });
    requests[0].complete();
    service.prepareVideoViewSession$('owner', 'video').subscribe();
    expect(transport).toHaveBeenCalledTimes(2);
    requests[1].complete();
  });

  it('não envia qualificação de vídeo agendada após logout', () => {
    vi.useFakeTimers();
    try {
      const { session, requests, transport } = setup();
      const service = TestBed.inject(VideoViewTrackingService);
      const now = Date.now();
      const sub = service.recordVideoView$('owner', 'video', 'profile', {
        sessionId: 'session-1234567890', playbackMs: 1000, durationMs: 2000, qualifiedAt: now,
      }).subscribe();
      requests[0].next({
        ownerUid: 'owner', videoId: 'video', playbackToken: 'x'.repeat(40),
        issuedAt: now, earliestQualifiedAt: now + 1000,
        expiresAt: now + 120000, requiredPlaybackMs: 1000,
      });
      requests[0].complete();
      session.isTerminatingSnapshot = true;
      session.terminationVersionSnapshot++;
      session.uid$.next(null);
      vi.advanceTimersByTime(2000);
      expect(sub.closed).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
