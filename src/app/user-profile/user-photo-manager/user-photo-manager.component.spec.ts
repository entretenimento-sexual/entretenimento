import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserPhotoManagerComponent } from './user-photo-manager.component';
import { PhotoFirestoreService } from '../../core/services/image-handling/photo-firestore.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

describe('UserPhotoManagerComponent', () => {
  let component: UserPhotoManagerComponent;
  let fixture: ComponentFixture<UserPhotoManagerComponent>;
  let photoService: {
    getPhotosByUser: ReturnType<typeof vi.fn>;
    deletePhoto: ReturnType<typeof vi.fn>;
  };
  let dialog: {
    open: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    photoService = {
      getPhotosByUser: vi.fn(() => of([])),
      deletePhoto: vi.fn(() => Promise.resolve()),
    };
    dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of(true),
      })),
    };

    await TestBed.configureTestingModule({
      imports: [UserPhotoManagerComponent],
      providers: [
        {
          provide: PhotoFirestoreService,
          useValue: photoService,
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: {
            report: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: MatDialog,
          useValue: dialog,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserPhotoManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('abre confirmação canônica antes de excluir', async () => {
    component.userId = 'u1';

    component.deleteFile('photo-1');

    expect(dialog.open).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(photoService.deletePhoto).toHaveBeenCalledWith(
      'u1',
      'photo-1'
    );
  });

  it('permite excluir foto sem path legado', async () => {
    component.userId = 'u1';

    component.deleteFile('photo-legacy');

    await Promise.resolve();
    expect(photoService.deletePhoto).toHaveBeenCalledWith(
      'u1',
      'photo-legacy'
    );
  });

  it('não exclui quando a confirmação é cancelada', async () => {
    dialog.open.mockReturnValue({
      afterClosed: () => of(false),
    } as any);
    component.userId = 'u1';

    component.deleteFile('photo-1');

    await Promise.resolve();
    expect(photoService.deletePhoto).not.toHaveBeenCalled();
  });
});
