// src/app/photo-editor/photo-editor/photo-editor.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, of } from 'rxjs';

import { PhotoEditorComponent } from './photo-editor.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { PhotoEditorSessionService } from '../../core/services/image-handling/photo-editor-session.service';
import { PhotoUploadFlowService } from '../../core/services/image-handling/photo-upload-flow.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createErrorTestingProviderMocks,
  provideErrorTestingMocks,
} from '../../../test/angular-error-testing.providers';

describe('PhotoEditorComponent', () => {
  let fixture: ComponentFixture<PhotoEditorComponent>;
  let component: PhotoEditorComponent;

  beforeEach(async () => {
    const existingPinturaStyles = document.getElementById('pintura-editor-styles');
    existingPinturaStyles?.remove();

    const pinturaStyles = document.createElement('link');
    pinturaStyles.id = 'pintura-editor-styles';
    pinturaStyles.dataset['loaded'] = 'true';
    document.head.appendChild(pinturaStyles);

    const errorProviderMocks = createErrorTestingProviderMocks();

    await TestBed.configureTestingModule({
      imports: [PhotoEditorComponent],
      providers: [
        {
          provide: NgbActiveModal,
          useValue: {
            close: vi.fn(),
            dismiss: vi.fn(),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            currentAuthUser: { uid: 'u1' },
          },
        },
        {
          provide: PhotoEditorSessionService,
          useValue: {
            peekDraft: vi.fn(() => null),
            clearDraft: vi.fn(),
          },
        },
        {
          provide: PhotoUploadFlowService,
          useValue: {
            uploadProcessedPhoto$: vi.fn(() => of({ id: 'photo-1' })),
            replaceProcessedPhoto$: vi.fn(() => of({ id: 'photo-1' })),
          },
        },
        ...provideErrorTestingMocks(errorProviderMocks),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PhotoEditorComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput(
      'imageFile',
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    );

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve definir userId a partir do AuthSessionService', () => {
    expect(component.userId).toBe('u1');
  });

  it('deve inicializar src a partir do imageFile quando não houver storedImageUrl', () => {
    expect(component.src).toBeTruthy();
  });

  it('deve inicializar observable de loading', async () => {
    await expect(firstValueFrom(component.isLoading$)).resolves.toBe(true);
  });

  it('deve converter imageState para JSON', () => {
    const result = component.stringifyImageState({
      crop: undefined,
    } as any);

    expect(typeof result).toBe('string');
    expect(result).toContain('"crop":null');
  });

  it('deve fazer parse do imageState', () => {
    const parsed = component.parseImageState('{"foo":"bar"}');

    expect(parsed as any).toEqual({ foo: 'bar' });
  });
});
