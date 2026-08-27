import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import {
  EMPTY_VIDEO_EDITOR_STATE,
  VideoEditorProcessedResult,
} from './video-editor-result.model';
import { VideoEditorLauncherService } from './video-editor-launcher.service';
import { VideoEditorSessionService } from './video-editor-session.service';

function makeVideo(name = 'video.mp4'): File {
  return new File(['video'], name, { type: 'video/mp4' });
}

describe('VideoEditorLauncherService', () => {
  it('abre sessão autenticada usando a origem canônica', async () => {
    const session = new VideoEditorSessionService();
    const globalError = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of(' owner-1 ') } },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
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
    expect(globalError.handleError).not.toHaveBeenCalled();
  });

  it('rejeita arquivo inválido antes de abrir sessão', async () => {
    const session = new VideoEditorSessionService();
    const globalError = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-2') } },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
    const invalid = new File(['text'], 'arquivo.txt', { type: 'text/plain' });

    await expect(firstValueFrom(launcher.launchFile$(invalid))).rejects.toThrow(
      'Formato inválido.'
    );
    expect(session.peekDraft()).toBeNull();
    expect(globalError.handleError).toHaveBeenCalledOnce();
  });

  it('não abre sessão sem usuário autenticado', async () => {
    const session = new VideoEditorSessionService();
    const globalError = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of(null) } },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);

    await expect(firstValueFrom(launcher.launchFile$(makeVideo()))).rejects.toThrow(
      'Usuário não autenticado para abrir o editor de vídeo.'
    );
    expect(session.peekDraft()).toBeNull();
    expect(globalError.handleError).toHaveBeenCalledOnce();
  });

  it('expõe estado e capa pela porta canônica respeitando a origem', async () => {
    const session = new VideoEditorSessionService();

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-feed') } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
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
    const session = new VideoEditorSessionService();

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-profile') } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
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

  it('ignora atualizações tardias quando a sessão já foi encerrada', () => {
    const session = new VideoEditorSessionService();

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-stale') } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
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

  it('conclui somente a sessão da origem solicitada', () => {
    const session = new VideoEditorSessionService();
    const globalError = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-3') } },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
    const file = makeVideo('ready.mp4');
    session.setDraft(file, 'owner-3', 'profile-videos');
    session.updateState({
      ...EMPTY_VIDEO_EDITOR_STATE,
      valid: true,
    });

    expect(() => launcher.complete('social-feed')).toThrow(
      'A sessão ativa pertence a outra origem de edição.'
    );

    const result: VideoEditorProcessedResult = launcher.complete('profile-videos');
    expect(result.file).toBe(file);
    expect(result.context).toBe('profile-video');
  });

  it('cancela apenas a origem solicitada', () => {
    const session = new VideoEditorSessionService();

    TestBed.configureTestingModule({
      providers: [
        VideoEditorLauncherService,
        { provide: VideoEditorSessionService, useValue: session },
        { provide: AuthSessionService, useValue: { uid$: of('owner-4') } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });

    const launcher = TestBed.inject(VideoEditorLauncherService);
    session.setDraft(makeVideo(), 'owner-4', 'community-feed');

    launcher.cancel('profile-videos');
    expect(session.peekDraft()?.source).toBe('community-feed');

    launcher.cancel('community-feed');
    expect(session.peekDraft()).toBeNull();
  });
});
