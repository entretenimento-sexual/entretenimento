import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { VideoMetadataPreparationService } from 'src/app/core/services/media/video-metadata-preparation.service';
import { VideoSimpleEditorControlsComponent } from './video-simple-editor-controls.component';

const METADATA = {
  durationMs: 30_000,
  widthPixels: 1920,
  heightPixels: 1080,
  posterBlob: null,
  posterMimeType: null,
  playbackReady: true,
} as const;

describe('VideoSimpleEditorControlsComponent', () => {
  let component: VideoSimpleEditorControlsComponent;
  let metadataPreparation: {
    prepare$: ReturnType<typeof vi.fn>;
    captureCurrentFrame$: ReturnType<typeof vi.fn>;
  };
  let errorNotification: {
    showSuccess: ReturnType<typeof vi.fn>;
    showWarning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    metadataPreparation = {
      prepare$: vi.fn(() => of(METADATA)),
      captureCurrentFrame$: vi.fn(() =>
        of(new Blob(['poster'], { type: 'image/jpeg' }))
      ),
    };
    errorNotification = {
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: VideoMetadataPreparationService,
          useValue: metadataPreparation,
        },
        {
          provide: ErrorNotificationService,
          useValue: errorNotification,
        },
      ],
    });

    component = TestBed.runInInjectionContext(
      () => new VideoSimpleEditorControlsComponent()
    );
    component.file = new File(['video'], 'video.mp4', {
      type: 'video/mp4',
    });
  });

  it('gera receita válida com corte, enquadramento e remoção de áudio', () => {
    component.form.patchValue({
      trimStartMs: 5_000,
      trimEndMs: 20_000,
      aspectRatio: 'SQUARE_1_1',
      muteAudio: true,
    });

    expect(component.buildRecipe()).toEqual({
      version: 1,
      trimStartMs: 5_000,
      trimEndMs: 20_000,
      aspectRatio: 'SQUARE_1_1',
      muteAudio: true,
      orientation: 'AUTO',
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    });
  });

  it('recusa um resultado com menos de cinco segundos', () => {
    component.form.patchValue({
      trimStartMs: 26_000,
      trimEndMs: 30_000,
    });

    expect(() => component.buildRecipe()).toThrow(
      'O vídeo editado precisa ter pelo menos 5 segundos.'
    );
  });

  it('captura a capa usando a proporção selecionada', () => {
    const posterChange = vi.spyOn(component.posterChange, 'emit');
    const video = document.createElement('video');
    component.form.patchValue({ aspectRatio: 'PORTRAIT_4_5' });

    component.capturePoster(video);

    expect(metadataPreparation.captureCurrentFrame$).toHaveBeenCalledWith(
      video,
      'PORTRAIT_4_5'
    );
    expect(posterChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg' })
    );
    expect(errorNotification.showSuccess).toHaveBeenCalledWith(
      'Capa do vídeo atualizada.'
    );
  });
});
