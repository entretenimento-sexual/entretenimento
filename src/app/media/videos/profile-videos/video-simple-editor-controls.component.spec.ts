import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
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

  it('mantém cinco segundos entre as duas alças durante o arraste', () => {
    const video = document.createElement('video');

    component.form.patchValue({
      trimStartMs: 29_000,
      trimEndMs: 30_000,
    });
    component.onTrimStartInput(video);

    expect(component.form.controls.trimStartMs.value).toBe(25_000);
    expect(component.activeTrimHandle).toBe('start');

    component.form.patchValue({
      trimStartMs: 20_000,
      trimEndMs: 21_000,
    });
    component.onTrimEndInput(video);

    expect(component.form.controls.trimEndMs.value).toBe(25_000);
    expect(component.activeTrimHandle).toBe('end');
  });

  it('calcula a faixa destacada e a duração resultante', async () => {
    component.form.patchValue({
      trimStartMs: 5_000,
      trimEndMs: 20_000,
    });

    const timeline = await firstValueFrom(component.trimTimeline$);

    expect(timeline.startMs).toBe(5_000);
    expect(timeline.endMs).toBe(20_000);
    expect(timeline.editedDurationMs).toBe(15_000);
    expect(timeline.startPercent).toBeCloseTo(16.666, 2);
    expect(timeline.endPercent).toBeCloseTo(66.666, 2);
  });

  it('informa quando existe corte e restaura o vídeo inteiro', async () => {
    const video = document.createElement('video');
    component.form.patchValue({
      trimStartMs: 5_000,
      trimEndMs: 20_000,
    });

    expect(await firstValueFrom(component.hasTrim$)).toBe(true);

    component.resetTrim(video);

    expect(component.form.controls.trimStartMs.value).toBe(0);
    expect(component.form.controls.trimEndMs.value).toBe(30_000);
    expect(component.activeTrimHandle).toBe('end');
    expect(component.buildRecipe().trimEndMs).toBeNull();
  });

  it('mantém a alça focada acima da outra quando elas ficam próximas', () => {
    component.setActiveTrimHandle('start');
    expect(component.activeTrimHandle).toBe('start');

    component.setActiveTrimHandle('end');
    expect(component.activeTrimHandle).toBe('end');
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

  it('controla o bloqueio dos campos pelo FormGroup reativo', () => {
    component.disabled = true;

    expect(component.form.disabled).toBe(true);
    expect(component.form.controls.trimStartMs.disabled).toBe(true);
    expect(component.form.controls.trimEndMs.disabled).toBe(true);
    expect(component.form.controls.aspectRatio.disabled).toBe(true);
    expect(component.form.controls.muteAudio.disabled).toBe(true);

    component.disabled = false;

    expect(component.form.enabled).toBe(true);
    expect(component.form.controls.trimStartMs.enabled).toBe(true);
    expect(component.form.controls.trimEndMs.enabled).toBe(true);
    expect(component.form.controls.aspectRatio.enabled).toBe(true);
    expect(component.form.controls.muteAudio.enabled).toBe(true);
  });
});
