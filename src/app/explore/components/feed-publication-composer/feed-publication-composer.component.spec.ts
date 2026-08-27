import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { resolveImageMaxBytes } from 'src/app/core/services/media/media-format.policy';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { FeedPublicationComposerComponent } from './feed-publication-composer.component';

describe('FeedPublicationComposerComponent', () => {
  let fixture: ComponentFixture<FeedPublicationComposerComponent>;
  let component: FeedPublicationComposerComponent;
  let editFileMock: ReturnType<typeof vi.fn>;
  let uploadMock: ReturnType<typeof vi.fn>;
  let publishMock: ReturnType<typeof vi.fn>;
  let showWarningMock: ReturnType<typeof vi.fn>;
  let showErrorMock: ReturnType<typeof vi.fn>;
  let globalErrorMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    editFileMock = vi.fn();
    uploadMock = vi.fn();
    publishMock = vi.fn(() => of(void 0));
    showWarningMock = vi.fn();
    showErrorMock = vi.fn();
    globalErrorMock = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:explore-photo'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    await TestBed.configureTestingModule({
      imports: [FeedPublicationComposerComponent],
      providers: [
        {
          provide: PhotoEditorLauncherService,
          useValue: { editFile$: editFileMock },
        },
        {
          provide: PhotoUploadFlowService,
          useValue: { uploadProcessedPhotoWithProgress$: uploadMock },
        },
        {
          provide: MediaPublicationService,
          useValue: { publishPhoto$: publishMock },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: showWarningMock,
            showError: showErrorMock,
            showSuccess: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: globalErrorMock },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedPublicationComposerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  function fileEvent(file: File): Event {
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as unknown as Event;
  }

  it('expõe o limite canônico de entrada de imagem usado pelo social-feed', () => {
    expect(component.imageMaxMegabytes).toBe(
      resolveImageMaxBytes('default') / 1024 / 1024
    );
  });

  it('rejeita formato fora da política social-feed antes de abrir o editor', () => {
    const file = new File(['gif'], 'foto.gif', { type: 'image/gif' });

    component.onFileSelected(fileEvent(file));

    expect(editFileMock).not.toHaveBeenCalled();
    expect(showWarningMock).toHaveBeenCalledTimes(1);
  });

  it('abre o editor canônico social-feed e guarda somente o resultado editado', () => {
    const source = new File(['original'], 'foto.jpg', { type: 'image/jpeg' });
    const edited = new File(['editada'], 'foto-editada.jpg', { type: 'image/jpeg' });
    editFileMock.mockReturnValue(of({
      kind: 'image',
      file: edited,
      imageStateStr: '{"editor":"native-canvas"}',
      width: 1200,
      height: 900,
      context: 'social-feed',
      preset: 'social-feed',
      metadataStripped: true,
    }));

    component.onFileSelected(fileEvent(source));

    expect(editFileMock).toHaveBeenCalledWith(source, {
      source: 'explore-publication',
      context: 'social-feed',
      preset: 'social-feed',
    });
    expect(component.selectedFile()).toBe(edited);
    expect(component.selectedImageState()).toBe('{"editor":"native-canvas"}');
    expect(component.previewUrl()).toBe('blob:explore-photo');
    expect(component.editingPhoto()).toBe(false);
  });

  it('preserva a foto anterior quando uma nova edição é cancelada', () => {
    const previous = new File(['anterior'], 'anterior.jpg', { type: 'image/jpeg' });
    const replacement = new File(['nova'], 'nova.jpg', { type: 'image/jpeg' });
    component.selectedFile.set(previous);
    component.selectedImageState.set('estado-anterior');
    editFileMock.mockReturnValue(of(null));

    component.onFileSelected(fileEvent(replacement));

    expect(component.selectedFile()).toBe(previous);
    expect(component.selectedImageState()).toBe('estado-anterior');
  });

  it('centraliza diagnóstico técnico quando o editor falha', () => {
    const source = new File(['original'], 'foto.jpg', { type: 'image/jpeg' });
    editFileMock.mockReturnValue(
      throwError(() => new Error('editor indisponível'))
    );

    component.onFileSelected(fileEvent(source));

    expect(showErrorMock).toHaveBeenCalledWith(
      'Não foi possível abrir o editor para esta foto.'
    );
    expect(globalErrorMock).toHaveBeenCalledTimes(1);
    expect(component.selectedFile()).toBeNull();
    expect(component.editingPhoto()).toBe(false);
  });

  it('envia o estado do editor junto da foto processada ao publicar', () => {
    const edited = new File(['editada'], 'foto-editada.webp', { type: 'image/webp' });
    component.selectedFile.set(edited);
    component.selectedImageState.set('estado-editor');
    uploadMock.mockReturnValue(of({
      type: 'success',
      result: {
        photoId: 'p1',
        url: 'https://example.test/p1.webp',
        path: 'users/u1/uploads/images/p1.webp',
        fileName: 'foto-editada.webp',
        createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    }));

    component.publish();

    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        processedFile: edited,
        imageStateStr: 'estado-editor',
      })
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});
