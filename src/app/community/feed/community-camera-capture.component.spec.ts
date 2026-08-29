import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import {
  CameraCaptureError,
  CameraCaptureService,
} from 'src/app/core/services/media/camera-capture.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityCameraCaptureComponent } from './community-camera-capture.component';

describe('CommunityCameraCaptureComponent', () => {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const cameraMock = {
    openCamera$: vi.fn(),
    captureFrame$: vi.fn(),
    stopStream: vi.fn(),
  };
  const photoEditorMock = {
    editFile$: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    cameraMock.openCamera$.mockReturnValue(of(stream));
    cameraMock.captureFrame$.mockReturnValue(
      of(new File(['foto'], 'captura.jpg', { type: 'image/jpeg' }))
    );
    photoEditorMock.editFile$.mockReturnValue(
      of({
        kind: 'image',
        file: new File(
          ['foto-editada'],
          'captura-editada.jpg',
          { type: 'image/jpeg' }
        ),
        imageStateStr: '{"version":2}',
        width: 1280,
        height: 720,
        context: 'community-feed',
        preset: 'social-feed',
        metadataStripped: true,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityCameraCaptureComponent],
      providers: [
        { provide: CameraCaptureService, useValue: cameraMock },
        { provide: PhotoEditorLauncherService, useValue: photoEditorMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('abre preview real, captura e devolve o mesmo attachment canônico de imagem', () => {
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    const captured: unknown[] = [];
    const closed = vi.fn();
    component.attachmentCaptured.subscribe((attachment) => captured.push(attachment));
    component.closed.subscribe(closed);
    fixture.detectChanges();

    component.openCamera();
    fixture.detectChanges();
    vi.runOnlyPendingTimers();
    fixture.detectChanges();

    expect(cameraMock.openCamera$).toHaveBeenCalledTimes(1);
    expect(component.state()).toBe('ready');
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();

    component.capturePhoto();
    fixture.detectChanges();
    expect(cameraMock.captureFrame$).toHaveBeenCalledTimes(1);
    expect(cameraMock.stopStream).toHaveBeenCalledWith(stream);
    expect(component.state()).toBe('captured');
    expect(fixture.nativeElement.textContent).toContain('Editar');

    component.useCapturedPhoto();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(expect.objectContaining({
      kind: 'image',
      file: expect.objectContaining({ name: 'captura.jpg', type: 'image/jpeg' }),
    }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(component.isOpen()).toBe(false);
  });

  it('permite editar a captura antes de confirmar e mantém o attachment canônico', () => {
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    const captured: unknown[] = [];
    component.attachmentCaptured.subscribe((attachment) => captured.push(attachment));
    fixture.detectChanges();

    component.openCamera();
    fixture.detectChanges();
    vi.runOnlyPendingTimers();
    fixture.detectChanges();
    component.capturePhoto();
    fixture.detectChanges();

    component.editCapturedPhoto();
    fixture.detectChanges();

    expect(photoEditorMock.editFile$).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'captura.jpg', type: 'image/jpeg' }),
      {
        source: 'community-feed-camera',
        context: 'community-feed',
        preset: 'social-feed',
      }
    );
    expect(component.state()).toBe('captured');

    component.useCapturedPhoto();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(expect.objectContaining({
      kind: 'image',
      file: expect.objectContaining({
        name: 'captura-editada.jpg',
        type: 'image/jpeg',
      }),
    }));
  });

  it('leva foto do seletor de câmera ao editor canônico antes de anexar', () => {
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    const captured: unknown[] = [];
    component.attachmentCaptured.subscribe((attachment) => captured.push(attachment));
    fixture.detectChanges();

    const sourceFile = new File(['device'], 'device.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    input.id = 'community-feed-camera-input';
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [sourceFile],
    });

    component.editDevicePhoto({ target: input } as unknown as Event);

    expect(photoEditorMock.editFile$).toHaveBeenCalledWith(sourceFile, {
      source: 'community-feed-camera',
      context: 'community-feed',
      preset: 'social-feed',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(expect.objectContaining({
      kind: 'image',
      file: expect.objectContaining({ name: 'captura-editada.jpg' }),
    }));
    expect(input.value).toBe('');
  });

  it('leva foto da galeria ao editor canônico com origem própria', () => {
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    const captured: unknown[] = [];
    component.attachmentCaptured.subscribe((attachment) => captured.push(attachment));
    fixture.detectChanges();

    const sourceFile = new File(['gallery'], 'galeria.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    input.id = 'community-feed-gallery-input';
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [sourceFile],
    });

    component.editDevicePhoto({ target: input } as unknown as Event);

    expect(photoEditorMock.editFile$).toHaveBeenCalledWith(sourceFile, {
      source: 'community-feed-gallery',
      context: 'community-feed',
      preset: 'social-feed',
    });
    expect(captured).toHaveLength(1);
  });

  it('mantém falha da câmera inline, oferece fallback e registra um único diagnóstico', () => {
    cameraMock.openCamera$.mockReturnValue(throwError(() => new CameraCaptureError(
      'UNSUPPORTED',
      'detalhe técnico que não deve controlar a interface'
    )));
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    const fallback = vi.fn();
    const closed = vi.fn();
    component.fallbackRequested.subscribe(fallback);
    component.closed.subscribe(closed);
    fixture.detectChanges();

    component.openCamera();
    fixture.detectChanges();
    vi.runOnlyPendingTimers();
    fixture.detectChanges();

    expect(component.state()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain(
      'Este navegador não oferece acesso direto à câmera. Use o seletor do dispositivo.'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'detalhe técnico que não deve controlar a interface'
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);

    component.useDeviceFallback();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(component.isOpen()).toBe(false);
  });

  it('traduz permissão negada para mensagem segura e acionável dentro da câmera', () => {
    cameraMock.openCamera$.mockReturnValue(throwError(() => new CameraCaptureError(
      'PERMISSION_DENIED',
      'raw browser detail'
    )));
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.openCamera();
    fixture.detectChanges();
    vi.runOnlyPendingTimers();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe(
      'Permita o acesso à câmera no navegador ou use o seletor do dispositivo.'
    );
    expect(component.errorMessage()).not.toContain('raw browser detail');
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('preserva a foto original e usa erro centralizado quando o editor falha', () => {
    photoEditorMock.editFile$.mockReturnValue(
      throwError(() => new Error('editor internal detail'))
    );
    const fixture = TestBed.createComponent(CommunityCameraCaptureComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.openCamera();
    fixture.detectChanges();
    vi.runOnlyPendingTimers();
    fixture.detectChanges();
    component.capturePhoto();
    fixture.detectChanges();

    component.editCapturedPhoto();
    fixture.detectChanges();

    expect(component.state()).toBe('captured');
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível editar a foto agora. A foto original foi preservada.'
    );
    expect(errorNotifierMock.showError.mock.calls[0]?.[0]).not.toContain(
      'editor internal detail'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
