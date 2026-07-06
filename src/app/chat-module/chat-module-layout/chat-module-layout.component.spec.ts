// src/app/chat-module/chat-module-layout/chat-module-layout.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatModuleLayoutComponent } from './chat-module-layout.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { RoomMessagesService } from '../../core/services/batepapo/room-services/room-messages.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { FriendshipService } from '../../core/services/interactions/friendship/friendship.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { DirectChatService } from '../../messaging/direct-chat/services/direct-chat.service';
import { DirectChatFacade } from '../../messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from '../../messaging/direct-chat/application/direct-thread.facade';

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatModuleLayoutComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        { provide: AuthSessionService, useValue: { uid$: of('u1'), authUser$: of({ uid: 'u1' }), ready$: of(true), whenReady: vi.fn(() => Promise.resolve()) } },
        { provide: CurrentUserStoreService, useValue: { user$: of({ uid: 'u1' }), getSnapshot: vi.fn(() => ({ uid: 'u1' })) } },
        { provide: AccessControlService, useValue: { canListenRealtime$: of(true) } },
        { provide: RoomMessagesService, useValue: { sendMessage: vi.fn(() => of(void 0)) } },
        { provide: FirestoreUserQueryService, useValue: { getPublicUserById$: vi.fn(() => of(null)) } },
        { provide: FriendshipService, useValue: {} },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn(), showSuccess: vi.fn() } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
        { provide: DirectChatService, useValue: { ensureDirectChatIdWithUser$: vi.fn(() => of('chat-id')) } },
        { provide: DirectChatFacade, useValue: { selectedChat$: of(null), selectChat: vi.fn(), clearSelection: vi.fn() } },
        { provide: DirectThreadFacade, useValue: { canSend$: of(true), sendMessage$: vi.fn(() => of('msg-id')) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatModuleLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
