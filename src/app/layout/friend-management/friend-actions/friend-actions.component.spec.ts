import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FriendActionsComponent } from './friend-actions.component';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { FriendshipService } from '../../../core/services/interactions/friendship/friendship.service';

describe('FriendActionsComponent', () => {
  let component: FriendActionsComponent;
  let fixture: ComponentFixture<FriendActionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendActionsComponent],
      providers: [
        {
          provide: Store,
          useValue: {
            dispatch: vi.fn(),
            select: vi.fn(() => of([])),
          },
        },
        {
          provide: FriendshipService,
          useValue: {
            blockUser: vi.fn(() => of(void 0)),
            unblockUser: vi.fn(() => of(void 0)),
            watchFriends: vi.fn(() => of([])),
            watchInboundRequests: vi.fn(() => of([])),
            watchOutboundRequests: vi.fn(() => of([])),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showSuccess: vi.fn(),
            showError: vi.fn(),
            showInfo: vi.fn(),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(FriendActionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
