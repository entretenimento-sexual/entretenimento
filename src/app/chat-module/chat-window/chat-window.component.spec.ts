import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
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
      imports: [FormsModule],
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

  it('não repete snackbar quando o ChatService já apresentou a falha', () => {
    const chatService = TestBed.inject(ChatService) as unknown as {
      sendMessage: ReturnType<typeof vi.fn>;
    };
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as {
      showError: ReturnType<typeof vi.fn>;
      showWarning: ReturnType<typeof vi.fn>;
    };
    const error = Object.assign(new Error('blocked'), { uiShown: true });

    chatService.sendMessage.mockReturnValue(
      throwError(() => error)
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});

    component.messageContent = 'Olá';
    component.sendMessage();

    expect(notifier.showError).not.toHaveBeenCalled();
  });

  it('mantém feedback genérico quando o erro ainda não foi apresentado', () => {
    const chatService = TestBed.inject(ChatService) as unknown as {
      sendMessage: ReturnType<typeof vi.fn>;
    };
    const notifier = TestBed.inject(
      ErrorNotificationService
    ) as unknown as {
      showError: ReturnType<typeof vi.fn>;
      showWarning: ReturnType<typeof vi.fn>;
    };

    chatService.sendMessage.mockReturnValue(
      throwError(() => new Error('repository failed'))
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});

    component.messageContent = 'Olá';
    component.sendMessage();

    expect(notifier.showError).toHaveBeenCalledTimes(1);
    expect(notifier.showError).toHaveBeenCalledWith(
      'Erro ao enviar mensagem.'
    );
  });
});
