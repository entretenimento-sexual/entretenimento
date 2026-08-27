import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedCommentsComponent } from './community-feed-comments.component';

describe('CommunityFeedCommentsComponent / resiliência realtime', () => {
  it('mantém leitura e compositor operacionais se o listener realtime falhar', () => {
    const repositoryMock = {
      getPage$: vi.fn(() => of({
        items: [],
        nextCursor: null,
        generatedAt: Date.now(),
      })),
      watchCommentCount$: vi.fn(() =>
        throwError(() => new Error('realtime unavailable'))
      ),
      createComment$: vi.fn(),
      moderateComment$: vi.fn(),
    };
    const feedRepositoryMock = {
      createPost$: vi.fn(),
    };
    const notificationMock = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
    };
    const globalErrorMock = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      imports: [CommunityFeedCommentsComponent],
      providers: [
        { provide: CommunityFeedCommentRepository, useValue: repositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: ErrorNotificationService, useValue: notificationMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });

    const fixture = TestBed.createComponent(CommunityFeedCommentsComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('postId', 'post-1');
    fixture.componentRef.setInput('canComment', true);
    fixture.detectChanges();

    expect(repositoryMock.getPage$).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector(
      '.feed-comments__composer textarea'
    )).not.toBeNull();
    expect(notificationMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledOnce();
  });
});
