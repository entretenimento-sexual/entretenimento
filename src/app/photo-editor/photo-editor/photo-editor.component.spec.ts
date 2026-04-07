// src/app/photo-editor/photo-editor/photo-editor.component.spec.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AngularPinturaModule } from '@pqina/angular-pintura';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { PhotoEditorComponent } from './photo-editor.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { StorageService } from '../../core/services/image-handling/storage.service';
import { PhotoFirestoreService } from '../../core/services/image-handling/photo-firestore.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import {
  selectFileUploading,
  selectFileError,
  selectFileSuccess,
  selectFileDownloadUrl,
} from '../../store/selectors/selectors.user/file.selectors';

describe('PhotoEditorComponent', () => {
  let fixture: ComponentFixture<PhotoEditorComponent>;
  let component: PhotoEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PhotoEditorComponent],
      imports: [
        CommonModule,
        AngularPinturaModule,
        MatProgressSpinnerModule,
      ],
      providers: [
        {
          provide: NgbActiveModal,
          useValue: {
            close: jasmine.createSpy('close'),
            dismiss: jasmine.createSpy('dismiss'),
          }
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            currentAuthUser: { uid: 'u1' },
          }
        },
        {
          provide: StorageService,
          useValue: {
            replaceFile: jasmine.createSpy('replaceFile').and.returnValue(
              of('https://example.com/file.jpg')
            )
          }
        },
        {
          provide: PhotoFirestoreService,
          useValue: {
            savePhotoMetadata: jasmine.createSpy('savePhotoMetadata').and.resolveTo(void 0),
            saveImageState: jasmine.createSpy('saveImageState').and.resolveTo(void 0),
            updatePhotoMetadata: jasmine.createSpy('updatePhotoMetadata').and.resolveTo(void 0),
          }
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: jasmine.createSpy('handleError')
          }
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: jasmine.createSpy('showSuccess'),
            showError: jasmine.createSpy('showError')
          }
        },
        provideMockStore({
          initialState: {},
          selectors: [
            { selector: selectFileUploading, value: false },
            { selector: selectFileError, value: null },
            { selector: selectFileSuccess, value: true },
            { selector: selectFileDownloadUrl, value: 'https://example.com/file.jpg' },
          ],
        }),
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

  it('deve inicializar observables do store', (done) => {
    component.isLoading$.subscribe((value) => {
      expect(value).toBe(false);
      done();
    });
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
