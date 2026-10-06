import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionStateDirective } from '../../action-state/action-state.directive';
import { UploadPhotoComponent } from './upload-photo.component';

describe('UploadPhotoComponent', () => {
  let fixture: ComponentFixture<UploadPhotoComponent>;
  let component: UploadPhotoComponent;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    closeMock = vi.fn();

    await TestBed.configureTestingModule({
      declarations: [UploadPhotoComponent],
      imports: [ActionStateDirective],
      providers: [
        {
          provide: NgbActiveModal,
          useValue: { close: closeMock, dismiss: vi.fn() },
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

  it('deve criar preservando a API pública do seletor', () => {
    expect(component).toBeTruthy();
    expect(component.photoSelected).toBeTruthy();
    expect(component.selectedImageFile).toBeNull();
    expect(component.maxUploadMegabytes).toBeGreaterThan(0);
  });

  it('recusa arquivo fora da política canônica', async () => {
    const file = new File(['texto'], 'arquivo.txt', { type: 'text/plain' });

    await component.onFileSelected(fileEvent(file));

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

    expect(component.errorMessage).toContain(`${component.maxUploadMegabytes} MB`);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('emite o arquivo selecionado sem abrir editor automaticamente', async () => {
    const source = new File(['original'], 'foto.webp', { type: 'image/webp' });
    const emitSpy = vi.spyOn(component.photoSelected, 'emit');

    await component.onFileSelected(fileEvent(source));

    expect(component.selectedImageFile).toBe(source);
    expect(emitSpy).toHaveBeenCalledWith(source);
    expect(closeMock).toHaveBeenCalledWith('success');
    expect(component.isLoading).toBe(false);
  });

  it('não fecha o modal enquanto estiver bloqueado por processamento externo', () => {
    component.isLoading = true;

    component.closeModal('cancel');

    expect(closeMock).not.toHaveBeenCalled();
  });
});
