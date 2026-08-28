import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { VideoEditorSessionService } from './video-editor-session.service';

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
  it('abre uma sessão canônica com contexto derivado da origem', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'profile.mp4', { type: 'video/mp4' });

    service.setDraft(file, ' owner-1 ', 'profile-videos');

    expect(service.peekDraft()).toEqual(expect.objectContaining({
      source: 'profile-videos',
      context: 'profile-video',
      ownerUid: 'owner-1',
      file,
      posterBlob: null,
      state: expect.objectContaining({
        recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
        valid: false,
        loading: false,
        error: null,
      }),
    }));
  });

  it('mantém estado e capa reativos dentro da sessão', async () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'feed.mp4', { type: 'video/mp4' });
    const poster = new Blob(['poster'], { type: 'image/jpeg' });

    service.setDraft(file, 'owner-2', 'social-feed');
    service.updateState({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    });
    service.updatePoster(poster);

    expect(await firstValueFrom(service.state$)).toEqual({
      recipe: EDIT_RECIPE,
      valid: true,
      loading: false,
      error: null,
    });
    expect(await firstValueFrom(service.posterBlob$)).toBe(poster);
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
    });
    service.updatePoster(poster);

    expect(service.buildResult()).toEqual({
      kind: 'video',
      file,
      recipe: EDIT_RECIPE,
      posterBlob: poster,
      context: 'community-feed',
    });
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
    });

    expect(() => service.buildResult()).toThrow('Revise o corte.');
  });

  it('não limpa uma sessão pertencente a outra superfície', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'feed.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-5', 'social-feed');
    service.clearDraft('profile-videos');

    expect(service.peekDraft()).toEqual(expect.objectContaining({
      source: 'social-feed',
      file,
    }));
  });

  it('limpa completamente a sessão efêmera', () => {
    const service = new VideoEditorSessionService();
    const file = new File(['video'], 'clear.mp4', { type: 'video/mp4' });

    service.setDraft(file, 'owner-6');
    service.clearDraft();

    expect(service.peekDraft()).toBeNull();
    expect(() => service.buildResult()).toThrow(
      'Nenhuma sessão de edição de vídeo está ativa.'
    );
  });
});
