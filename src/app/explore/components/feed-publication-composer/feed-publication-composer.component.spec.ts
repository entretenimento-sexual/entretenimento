import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { FeedPublicationComposerComponent } from './feed-publication-composer.component';

describe('FeedPublicationComposerComponent', () => {
  const uploadFlowMock = {
    uploadProcessedPhotoWithProgress$: vi.fn(() =>
      of(
        { type: 'progress' as const, progress: 45 },
        {
          type: 'success' as const,
          result: {
            photoId: 'photo-1',
            url: 'https://example.test/private-photo.webp',
            path: 'users/u1/images/photo.webp',
            fileName: 'photo.webp',
            createdAt: new Date('2026-07-22T20:00:00.000Z'),
          },
        }
      )
    ),
  };
  const publicationMock = {
    publishPhoto$: vi.fn(() => of(void 0)),
  };
  const notificationsMock = {
    showWarning: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };

  let fixture: ComponentFixture<FeedPublicationComposerComponent>;
  let component: FeedPublicationComposerComponent;

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [FeedPublicationComposerComponent],
      providers: [
        { provide: PhotoUploadFlowService, useValue: uploadFlowMock },
        { provide: MediaPublicationService, useValue: publicationMock },
        { provide: ErrorNotificationService, useValue: notificationsMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedPublicationComposerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', { uid: 'u1', nickname: 'Serale' });
    fixture.detectChanges();
  });

  it('não publica sem foto', () => {
    component.publish();

    expect(uploadFlowMock.uploadProcessedPhotoWithProgress$).not.toHaveBeenCalled();
    expect(notificationsMock.showWarning).toHaveBeenCalledWith(
      'Escolha uma foto para a publicação.'
    );
  });

  it('envia a foto e promove a mesma mídia para a projeção pública', () => {
    const file = new File(['image'], 'foto.webp', { type: 'image/webp' });
    const published = vi.fn();

    component.published.subscribe(published);
    component.selectedFile.set(file);
    component.captionControl.setValue('  Olá\n   mundo  ');
    component.publish();

    expect(uploadFlowMock.uploadProcessedPhotoWithProgress$).toHaveBeenCalledWith({
      userId: 'u1',
      processedFile: file,
      originalFileName: 'foto.webp',
      mimeType: 'image/webp',
    });
    expect(publicationMock.publishPhoto$).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'u1',
        visibility: 'PUBLIC',
        caption: 'Olá mundo',
        commentsEnabled: true,
        commentsPolicy: 'EVERYONE',
        reactionsEnabled: true,
        photo: expect.objectContaining({
          id: 'photo-1',
          ownerUid: 'u1',
          path: 'users/u1/images/photo.webp',
        }),
      })
    );
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith(
      'Publicação enviada.'
    );
    expect(published).toHaveBeenCalledTimes(1);
  });
});
