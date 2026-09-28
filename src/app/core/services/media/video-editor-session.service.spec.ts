import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import {
  VIDEO_EDITOR_DRAFT_IDLE_TTL_MS,
  VideoEditorSessionService,
} from './video-editor-session.service';

const EDIT_RECIPE: IVideoEditRecipeInput = {
  ...DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  trimStartMs: 5_000,
  trimEndMs: 20_000,
  aspectRatio: 'PORTRAIT_4_5',
  rotationDegrees: 90,
  muteAudio: true,
  sourceWidthPixels: 1920,
  sourceHeightPixels: 1080,
};

describe('VideoEditorSessionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('abre uma sessão canônica com contexto derivado da origem e TTL de inatividade', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));

    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'profile.mp4', { type: 'video/mp4' });

    service.setDraft(file, ' owner-1 ', 'profile-videos');

    expect(service.peekDraft()).toEqual(expect.objectContaining({
      source: 'profile-videos',
      context: 'profile-video',
      ownerUid: 'owner-1',
      file,
      posterBlob: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + VIDEO_EDITOR_DRAFT_IDLE_TTL_MS,
      state: expect.objectContaining({
        recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
        valid: false,
        loading: false,
        error: null,
      }),
    }));
  });

  it('mantém estado e capa reativos e renova o TTL somente com atividade', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));

    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'feed.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-2', 'social-feed');
    const initialExpiry = service.peekDraft('owner-2')?.expiresAt ?? 0;

    vi.advanceTimersByTime(5_000);
    service.updateState({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    }, 'owner-2');
    service.updatePoster(poster, 'owner-2');

    expect(service.peekDraft('owner-2')?.expiresAt).toBeGreaterThan(initialExpiry);
    expect(await firstValueFrom(service.state$)).toEqual({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    });
    expect(await firstValueFrom(service.posterBlob$)).toBe(poster);
  });

  it('expira draft inativo e remove referências fortes a File e Blob', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));

    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'expire.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-expire', 'profile-videos');
    service.updatePoster(poster, 'owner-expire');

    vi.advanceTimersByTime(VIDEO_EDITOR_DRAFT_IDLE_TTL_MS + 1);

    expect(service.peekDraft()).toBeNull();
    expect(service.lastTeardownReason).toBe('expired');
    expect(() => service.buildResult('owner-expire')).toThrow(
      'A sessão do editor de vídeo expirou por inatividade.'
    );
  });

  it('derruba imediatamente o draft quando a autoridade autenticada muda', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'auth.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-a', 'profile-videos');
    service.updatePoster(poster, 'owner-a');

    expect(service.clearIfOwnerMismatch('owner-b')).toBe(true);
    expect(service.peekDraft()).toBeNull();
    expect(service.lastTeardownReason).toBe('auth-changed');
    expect(() => service.buildResult('owner-a')).toThrow(
      'Sua sessão de usuário mudou.'
    );
  });

  it('não derruba o draft quando a autoridade autenticada continua a mesma', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'same-owner.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-a', 'profile-videos');

    expect(service.clearIfOwnerMismatch('owner-a')).toBe(false);
    expect(service.peekDraft('owner-a')?.file).toBe(file);
  });

  it('constrói resultado puro sem transformar o arquivo no navegador', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['original'], 'community.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-3', 'community-feed');
    service.updateState({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    }, 'owner-3');
    service.updatePoster(poster, 'owner-3');

    expect(service.buildResult('owner-3')).toEqual({
      kind: 'video',
      file,
      recipe: EDIT_RECIPE,
      posterBlob: poster,
      context: 'community-feed',
    });
  });

  it('takeResult transfere o resultado e sempre encerra as refs internas', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['original'], 'complete.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-complete', 'profile-videos');
    service.updateState({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    }, 'owner-complete');
    service.updatePoster(poster, 'owner-complete');

    const result = service.takeResult('owner-complete', 'profile-videos');

    expect(result.file).toBe(file);
    expect(result.posterBlob).toBe(poster);
    expect(service.peekDraft()).toBeNull();
    expect(service.lastTeardownReason).toBe('completed');
  });

  it('não produz resultado enquanto a edição estiver inválida', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'invalid.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-4');
    service.updateState({
      recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
      valid: false,
      loading: false,
      error: 'Revise o corte.',
    }, 'owner-4');

    expect(() => service.buildResult('owner-4')).toThrow('Revise o corte.');
  });

  it('não limpa uma sessão pertencente a outra superfície', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'feed.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-5', 'social-feed');
    service.clearDraft('profile-videos');

    expect(service.peekDraft('owner-5')).toEqual(expect.objectContaining({
      source: 'social-feed',
      file,
    }));
  });

  it('limpa completamente a sessão efêmera', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'clear.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-6');
    service.clearDraft(undefined, 'cancelled');

    expect(service.peekDraft()).toBeNull();
    expect(service.lastTeardownReason).toBe('cancelled');
    expect(() => service.buildResult()).toThrow(
      'Nenhuma sessão de edição de vídeo está ativa.'
    );
  });
});
