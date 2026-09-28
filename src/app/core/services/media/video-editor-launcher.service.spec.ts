import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import {
  EMPTY_VIDEO_EDITOR_STATE,
  VideoEditorProcessedResult,
} from './video-editor-result.model';
import { VideoEditorLauncherService } from './video-editor-launcher.service';
import { VideoEditorSessionService } from './video-editor-session.service';

function makeVideo(name = 'video.mp4'): File {
  return new File(['video'], name, { type: 'video/mp4' });
}

function configure(uid$: Observable<string | null>) {
  const session = new VideoEditorSessionService();
  const mediaError = {
    reportSilently: vi.fn(),
  };
  const authSession = {
    uid$,
    isTerminatingSnapshot: false,
  };

  TestBed.configureTestingModule({
    providers: [
      VideoEditorLauncherService,
      { provide: VideoEditorSessionService, useValue: session },
      { provide: AuthSessionService, useValue: authSession },
      { provide: MediaApplicationErrorService, useValue: mediaError },
    ],
  });

  return {
    launcher: TestBed.inject(VideoEditorLauncherService),
    session,
    mediaError,
    authSession,
  };
}

describe('VideoEditorLauncherService', () => {
  it('abre sessão autenticada usando a origem canônica', async () => {
    const { launcher, session, mediaError } = configure(of(' owner-1 '));
    const file = makeVideo();
    const draft = await firstValueFrom(launcher.launchFile$(file, {
      source: 'profile-videos',
    }));

    expect(draft).toEqual(expect.objectContaining({
      ownerUid: 'owner-1',
      source: 'profile-videos',
      context: 'profile-video',
      file,
      state: EMPTY_VIDEO_EDITOR_STATE,
      posterBlob: null,
    }));
    expect(session.peekDraft('owner-1')?.file).toBe(file);
    expect(mediaError.reportSilently).not.toHaveBeenCalled();
  });

  it('rejeita arquivo inválido antes de abrir sessão', async () => {
    const { launcher, session, mediaError } = configure(of('owner-2'));
    const invalid = new File(['text'], 'arquivo.txt', { type: 'text/plain' });

    await expect(firstValueFrom(launcher.launchFile$(invalid))).rejects.toThrow(
      'Formato inválido.'
    );
    expect(session.peekDraft()).toBeNull();
    expect(mediaError.reportSilently).toHaveBeenCalledOnce();
  });

  it('não abre sessão sem usuário autenticado', async () => {
    const { launcher, session, mediaError } = configure(of(null));

    await expect(firstValueFrom(launcher.launchFile$(makeVideo()))).rejects.toThrow(
      'Usuário não autenticado para abrir o editor de vídeo.'
    );
    expect(session.peekDraft()).toBeNull();
    expect(mediaError.reportSilently).toHaveBeenCalledOnce();
  });

  it('expõe estado e capa pela porta canônica respeitando origem e owner', async () => {
    const { launcher, session } = configure(of('owner-feed'));
    const poster = new Blob(['poster'], { type: 'image/jpeg' });
    const state = {
      ...EMPTY_VIDEO_EDITOR_STATE,
      valid: true,
    };

    session.setDraft(makeVideo('feed.mp4'), 'owner-feed', 'social-feed');
    launcher.updateState(state, 'social-feed');
    launcher.updatePoster(poster, 'social-feed');

    expect(await firstValueFrom(launcher.state$)).toEqual(state);
    expect(await firstValueFrom(launcher.posterBlob$)).toBe(poster);
    expect(() => launcher.updatePoster(null, 'profile-videos')).toThrow(
      'A sessão ativa pertence a outra origem de edição.'
    );
  });

  it('isola draft, estado e capa por origem para consumidores concorrentes', async () => {
    const { launcher, session } = configure(of('owner-profile'));
    const poster = new Blob(['poster'], { type: 'image/jpeg' });
    const state = { ...EMPTY_VIDEO_EDITOR_STATE, valid: true };

    session.setDraft(makeVideo('profile.mp4'), 'owner-profile', 'profile-videos');
    launcher.updateState(state, 'profile-videos');
    launcher.updatePoster(poster, 'profile-videos');

    expect(await firstValueFrom(launcher.draftForSource$('profile-videos')))
      .toEqual(expect.objectContaining({ source: 'profile-videos' }));
    expect(await firstValueFrom(launcher.stateForSource$('profile-videos')))
      .toEqual(state);
    expect(await firstValueFrom(launcher.posterBlobForSource$('profile-videos')))
      .toBe(poster);

    expect(await firstValueFrom(launcher.draftForSource$('social-feed'))).toBeNull();
    expect(await firstValueFrom(launcher.stateForSource$('social-feed'))).toBeNull();
    expect(await firstValueFrom(launcher.posterBlobForSource$('social-feed'))).toBeNull();
  });

  it('derruba File/Blob imediatamente em logout ou troca de usuário', async () => {
    const uidSubject = new BehaviorSubject<string | null>('owner-a');
    const { launcher, session } = configure(uidSubject.asObservable());
    const file = makeVideo('auth-boundary.mp4');
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    await firstValueFrom(launcher.launchFile$(file, {
      source: 'profile-videos',
    }));
    launcher.updatePoster(poster, 'profile-videos');

    expect(session.peekDraft('owner-a')).toEqual(expect.objectContaining({
      file,
      posterBlob: poster,
    }));

    uidSubject.next('owner-b');

    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('auth-changed');
    expect(() => launcher.complete('profile-videos')).toThrow(
      'Sua sessão de usuário mudou.'
    );
  });

  it('trata início de termination como auth-boundary mesmo antes do signOut técnico', async () => {
    const { launcher, session, authSession } = configure(of('owner-term'));
    await firstValueFrom(launcher.launchFile$(makeVideo('term.mp4'), {
      source: 'profile-videos',
    }));

    authSession.isTerminatingSnapshot = true;

    expect(() => launcher.complete('profile-videos')).toThrow(
      'Sua sessão de usuário mudou.'
    );
    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('auth-changed');
  });

  it('ignora atualizações tardias quando a sessão já foi encerrada', () => {
    const { launcher, session } = configure(of('owner-stale'));

    session.setDraft(makeVideo('stale.mp4'), 'owner-stale', 'profile-videos');
    launcher.cancel('profile-videos');

    expect(() => launcher.updateState(
      { ...EMPTY_VIDEO_EDITOR_STATE, valid: true },
      'profile-videos'
    )).not.toThrow();
    expect(() => launcher.updatePoster(
      new Blob(['late'], { type: 'image/jpeg' }),
      'profile-videos'
    )).not.toThrow();
    expect(session.peekDraft()).toBeNull();
  });

  it('conclui somente a sessão da origem solicitada e transfere refs uma única vez', () => {
    const { launcher, session } = configure(of('owner-3'));
    const file = makeVideo('ready.mp4');
    session.setDraft(file, 'owner-3', 'profile-videos');
    session.updateState({
      ...EMPTY_VIDEO_EDITOR_STATE,
      valid: true,
    }, 'owner-3');

    expect(() => launcher.complete('social-feed')).toThrow(
      'A sessão ativa pertence a outra origem de edição.'
    );

    const result: VideoEditorProcessedResult = launcher.complete('profile-videos');
    expect(result.file).toBe(file);
    expect(result.context).toBe('profile-video');
    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('completed');
  });

  it('cancela apenas a origem solicitada', () => {
    const { launcher, session } = configure(of('owner-4'));
    session.setDraft(makeVideo(), 'owner-4', 'community-feed');

    launcher.cancel('profile-videos');
    expect(session.peekDraft('owner-4')?.source).toBe('community-feed');

    launcher.cancel('community-feed');
    expect(session.peekDraft()).toBeNull();
    expect(session.lastTeardownReason).toBe('cancelled');
  });
});
