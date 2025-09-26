// src/app/photo-editor/photo-editor/photo-editor.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AngularPinturaModule } from '@pqina/angular-pintura';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { PhotoEditorComponent } from './photo-editor.component';
import { AuthService } from '../../core/services/autentication/auth.service';
import { StorageService } from '../../core/services/image-handling/storage.service';
import { PhotoFirestoreService } from '../../core/services/image-handling/photo-firestore.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import {
  selectFileUploading,
  selectFileError,
  selectFileSuccess,
  selectFileDownloadUrl,
} from '../../../app/store/selectors/selectors.user/file.selectors';

describe('PhotoEditorComponent', () => {
  let fixture: ComponentFixture<PhotoEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PhotoEditorComponent],
      imports: [
        CommonModule,
        AngularPinturaModule,
        MatProgressSpinnerModule,
      ],
      providers: [
        { provide: NgbActiveModal, useValue: { close: () => { }, dismiss: () => { } } },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1' }) } },
        { provide: StorageService, useValue: { replaceFile: () => of('https://example.com/file.jpg') } },
        { provide: PhotoFirestoreService, useValue: { savePhotoMetadata: async () => { }, saveImageState: async () => { }, updatePhotoMetadata: async () => { } } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: () => { } } },
        { provide: ErrorNotificationService, useValue: { showSuccess: () => { }, showError: () => { } } },
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
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
