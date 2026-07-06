import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ChatWindowComponent } from './chat-window.component';
import { ChatService } from '../../core/services/batepapo/chat-service/chat.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

describe('ChatWindowComponent', () => {
  let component: ChatWindowComponent;
  let fixture: ComponentFixture<ChatWindowComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ChatWindowComponent],
      providers: [
        {
          provide: ChatService,
          useValue: {
            sendMessage: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1', nickname: 'Usuário' }),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ChatWindowComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
