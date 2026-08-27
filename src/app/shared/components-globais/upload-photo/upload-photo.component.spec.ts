import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { ActionStateDirective } from '../../action-state/action-state.directive';
import { UploadPhotoComponent } from './upload-photo.component';

describe('UploadPhotoComponent', () => {
  let fixture: ComponentFixture<UploadPhotoComponent>;
  let component: UploadPhotoComponent;
  let editFileMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;
  let showErrorMock: ReturnType<typeof vi.fn>;
  let globalErrorMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    editFileMock = vi.fn();
    closeMock = vi.fn();
    showErrorMock = vi.fn();
    globalErrorMock = vi.fn();

    await TestBed.configureTestingModule({
      declarations: [UploadPhotoComponent],
      imports: [ActionStateDirective],
      providers: [
        {
          provide: NgbActiveModal,
          useValue: { close: closeMock, dismiss: vi.fn() },
        },
        {
          provide: PhotoEditorLauncherService,
          useValue: { editFile$: editFileMock },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: showErrorMock },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: globalErrorMock },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadPhotoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function fileEvent(file: File): Event {
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as unknown as Event;
  }

  function editorResult(file: File) {
    return {
      kind: 'image' as const,
      file,
      imageStateStr: '{"editor":"native-canvas"}',
      width: 1200,
      height: 900,
      context: 'generic' as const,
      preset: 'free' as const,
      metadataStripped: true as const,
    };
  }

  it('deve criar preservando a API pública do seletor', () => {
    expect(component).toBeTruthy();
    expect(component.photoSelected).toBeTruthy();
    expect(component.selectedImageFile).toBeNull();
    expect(component.maxUploadMegabytes).toBeGreaterThan(0);
  });

  it('recusa arquivo fora da política canônica antes de abrir o editor', async () => {
    const file = new File(['texto'], 'arquivo.txt', { type: 'text/plain' });

    await component.onFileSelected(fileEvent(file));

    expect(editFileMock).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('Formato inválido');
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('recusa imagem acima do limite canônico', async () => {
    const maxBytes = Math.round(component.maxUploadMegabytes * 1024 * 1024);
    const file = new File(
      [new Uint8Array(maxBytes + 1)],
      'grande.jpg',
      { type: 'image/jpeg' }
    );

    await component.onFileSelected(fileEvent(file));

    expect(editFileMock).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain(`${component.maxUploadMegabytes} MB`);
  });

  it('executa política -> editor canônico -> photoSelected e fecha com sucesso', async () => {
    const source = new File(['original'], 'foto.webp', { type: 'image/webp' });
    const edited = new File(['editada'], 'foto-editada.webp', { type: 'image/webp' });
    editFileMock.mockReturnValue(of(editorResult(edited)));
    const emitSpy = vi.spyOn(component.photoSelected, 'emit');

    await component.onFileSelected(fileEvent(source));

    expect(editFileMock).toHaveBeenCalledWith(source, {
      source: 'global-photo-upload',
      context: 'generic',
      preset: 'free',
    });
    expect(component.selectedImageFile).toBe(edited);
    expect(emitSpy).toHaveBeenCalledWith(edited);
    expect(closeMock).toHaveBeenCalledWith('success');
    expect(component.isLoading).toBe(false);
  });

  it('mantém o modal aberto quando o usuário cancela o editor', async () => {
    const source = new File(['original'], 'foto.png', { type: 'image/png' });
    editFileMock.mockReturnValue(of(null));
    const emitSpy = vi.spyOn(component.photoSelected, 'emit');

    await component.onFileSelected(fileEvent(source));

    expect(emitSpy).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
    expect(component.errorMessage).toBeNull();
    expect(component.isLoading).toBe(false);
  });

  it('mantém o modal aberto e centraliza diagnóstico quando o editor falha', async () => {
    editFileMock.mockReturnValue(
      throwError(() => new Error('decoder failed'))
    );
    const file = new File(['imagem'], 'foto.png', { type: 'image/png' });

    await component.onFileSelected(fileEvent(file));

    expect(component.errorMessage).toContain('Não foi possível preparar');
    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(globalErrorMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('não fecha o modal enquanto o arquivo está sendo processado', () => {
    component.isLoading = true;

    component.closeModal('cancel');

    expect(closeMock).not.toHaveBeenCalled();
  });
});
