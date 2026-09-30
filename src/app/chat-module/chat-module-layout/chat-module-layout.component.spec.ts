import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatModuleLayoutComponent } from './chat-module-layout.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from '../../messaging/direct-chat/application/direct-thread.facade';
import { DirectChatNavigationOrchestrator } from '../application/direct-chat-navigation.orchestrator';
import { DirectChatComposeAccessFacade } from '../application/direct-chat-compose-access.facade';

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatModuleLayoutComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
            authUser$: of({ uid: 'u1' }),
            ready$: of(true),
            whenReady: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1' }),
            getSnapshot: vi.fn(() => ({ uid: 'u1' })),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
        {
          provide: DirectChatFacade,
          useValue: {
            selectedChat$: of(null),
            selectChat: vi.fn(),
            clearSelection: vi.fn(),
          },
        },
        {
          provide: DirectThreadFacade,
          useValue: {
            canSend$: of(true),
            sendMessage$: vi.fn(() => of('msg-id')),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(ChatModuleLayoutComponent, {
        set: {
          providers: [
            {
              provide: DirectChatNavigationOrchestrator,
              useValue: {
                observeResolvedDeepLinks$: vi.fn(() => of(null)),
                consumeDeepLinkQueryParams: vi.fn(() => Promise.resolve(true)),
                resolvePeer$: vi.fn(() => of(null)),
              },
            },
            {
              provide: DirectChatComposeAccessFacade,
              useValue: {
                observe$: vi.fn(() =>
                  of({
                    canCompose: true,
                    canSendDirect: true,
                    hasAcceptedConnection: false,
                    canSendCurrentMessage: false,
                    statusMessage:
                      'Vocês precisam estar conectados para trocar mensagens.',
                  })
                ),
              },
            },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ChatModuleLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('mantém apenas atalhos do chat direto no estado vazio', () => {
    const text = fixture.nativeElement.textContent as string;
    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    ).map((link) => link.getAttribute('href'));

    expect(text).toContain('Conexões');
    expect(text).toContain('Solicitações de conexão');
    expect(text).not.toContain('Salas');
    expect(hrefs).toContain('/friends/requests');
    expect(hrefs).not.toContain('/chat/rooms');
    expect(hrefs).not.toContain('/chat/room-invites');
    expect(hrefs).not.toContain('/chat/invite-list');
  });
});
