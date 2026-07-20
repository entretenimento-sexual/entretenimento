import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadPhotoComponent } from './upload-photo.component';
import { PhotoService } from 'src/app/core/services/image-handling/photo.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ActionStateDirective } from '../../action-state/action-state.directive';

describe('UploadPhotoComponent', () => {
  let fixture: ComponentFixture<UploadPhotoComponent>;
  let component: UploadPhotoComponent;
  let processFileMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;
  let showErrorMock: ReturnType<typeof vi.fn>;
  let globalErrorMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    processFileMock = vi.fn(async (file: File) => file);
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
          provide: PhotoService,
          useValue: { processFile: processFileMock },
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

  it('deve criar', () => {
    expect(component).toBeTruthy();
  });

  it('recusa arquivo que não é imagem suportada', async () => {
    const file = new File(['texto'], 'arquivo.txt', { type: 'text/plain' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    await component.onFileSelected({ target: input } as unknown as Event);

    expect(processFileMock).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('JPG, PNG ou WebP');
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('recusa imagem acima de 15 MB', async () => {
    const file = new File(
      [new Uint8Array(15 * 1024 * 1024 + 1)],
      'grande.jpg',
      { type: 'image/jpeg' }
    );
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    await component.onFileSelected({ target: input } as unknown as Event);

    expect(processFileMock).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('15 MB');
  });

  it('processa imagem válida, emite arquivo e fecha com sucesso', async () => {
    const file = new File(['imagem'], 'foto.webp', { type: 'image/webp' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    const emitSpy = vi.spyOn(component.photoSelected, 'emit');

    await component.onFileSelected({ target: input } as unknown as Event);

    expect(processFileMock).toHaveBeenCalledWith(file);
    expect(emitSpy).toHaveBeenCalledWith(file);
    expect(closeMock).toHaveBeenCalledWith('success');
    expect(component.isLoading).toBe(false);
  });

  it('mantém o modal aberto e centraliza diagnóstico quando o processamento falha', async () => {
    processFileMock.mockRejectedValueOnce(new Error('decoder failed'));
    const file = new File(['imagem'], 'foto.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    await component.onFileSelected({ target: input } as unknown as Event);

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
