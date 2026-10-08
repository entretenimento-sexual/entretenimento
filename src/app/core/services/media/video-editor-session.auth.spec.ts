import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { VideoEditorSessionService } from './video-editor-session.service';

function harness() {
  const uid$ = new BehaviorSubject<string | null>('owner-a');
  const auth = { uid$: uid$.asObservable(), isTerminatingSnapshot: false };
  TestBed.configureTestingModule({
    providers: [
      VideoEditorSessionService,
      { provide: AuthSessionService, useValue: auth },
    ],
  });
  return { session: TestBed.inject(VideoEditorSessionService), uid$, auth };
}

describe('VideoEditorSessionService / isolamento de rascunhos', () => {
  afterEach(() => vi.useRealTimers());

  it('libera File, poster Blob e timer em logout sem depender do launcher', async () => {
    vi.useFakeTimers();
    const { session, uid$ } = harness();
    const file = new File(['video-a'], 'video-a.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster-a'], { type: 'image/jpeg' });

    session.setDraft(file, 'owner-a', 'profile-videos');
    session.updatePoster(poster, 'owner-a');
    expect(session.peekDraft('owner-a')).toMatchObject({ file, posterBlob: poster });

    uid$.next(null);
    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('auth-changed');
    expect(await firstValueFrom(session.posterBlob$)).toBeNull();
    expect(await firstValueFrom(session.state$)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('não permite que callbacks de A reconstituam draft sob B, inclusive após A→B→A', () => {
    const { session, uid$ } = harness();
    session.setDraft(new File(['a'], 'a.mp4'), 'owner-a');
    uid$.next('owner-b');
    expect(() => session.setDraft(new File(['old'], 'old.mp4'), 'owner-a')).toThrow('Sua sessão');
    expect(session.peekDraft()).toBeNull();

    session.setDraft(new File(['b'], 'b.mp4'), 'owner-b');
    uid$.next('owner-a');
    expect(session.peekDraft()).toBeNull();
    expect(() => session.updatePoster(new Blob(['late-a']), 'owner-b')).toThrow('Sua sessão');
    expect(session.peekDraft()).toBeNull();
  });

  it('termination invalida o draft mesmo antes do signOut técnico', () => {
    const { session, auth } = harness();
    session.setDraft(new File(['a'], 'a.mp4'), 'owner-a');
    auth.isTerminatingSnapshot = true;

    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('auth-changed');
    expect(() => session.setDraft(new File(['a'], 'a.mp4'), 'owner-a')).toThrow('Sua sessão');
  });
});
