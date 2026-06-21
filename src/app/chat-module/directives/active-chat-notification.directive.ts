// src/app/chat-module/directives/active-chat-notification.directive.ts
// -----------------------------------------------------------------------------
// ActiveChatNotificationDirective
// -----------------------------------------------------------------------------
// Registra a conversa direta atualmente aberta para o ChatNotificationService.
//
// Objetivo:
// - evitar badge/notificação de mensagem recebida quando o usuário já está
//   olhando a própria conversa;
// - manter ChatModuleLayoutComponent focado em layout/seleção;
// - centralizar decisão de notificação no serviço correto;
// - limpar a conversa ativa quando a aba fica oculta;
// - registrar novamente quando a aba volta a ficar visível.
//
// SUPRESSÃO EXPLÍCITA:
// - não registra rooms nesta etapa.
//
// Motivo:
// - o problema relatado está no chat direto 1:1;
// - salas têm semântica diferente de unread/notificação e devem ter regra própria.
// -----------------------------------------------------------------------------

import {
  Directive,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  inject,
} from '@angular/core';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

@Directive({
  selector: '[appActiveChatNotification]',
  standalone: false,
})
export class ActiveChatNotificationDirective implements OnChanges, OnDestroy, OnInit {
  private readonly chatNotification = inject(ChatNotificationService);

  @Input() appActiveChatNotification: string | null | undefined;

  private registeredChatId: string | null = null;
  private readonly handleVisibilityChange = (): void => {
    this.syncActiveChatWithVisibility('visibilitychange');
  };

  ngOnInit(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appActiveChatNotification']) {
      return;
    }

    const nextChatId = String(this.appActiveChatNotification ?? '').trim() || null;

    if (nextChatId === this.registeredChatId) {
      this.syncActiveChatWithVisibility('same-chat-change');
      return;
    }

    this.registeredChatId = nextChatId;
    this.syncActiveChatWithVisibility('active-chat-directive');
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.chatNotification.clearActiveChat('active-chat-directive-destroy');
    this.registeredChatId = null;
  }

  private syncActiveChatWithVisibility(reason: string): void {
    if (!this.registeredChatId) {
      this.chatNotification.clearActiveChat(`${reason}:empty`);
      return;
    }

    if (this.isDocumentVisible()) {
      this.chatNotification.setActiveChat(this.registeredChatId, `${reason}:visible`);
      return;
    }

    this.chatNotification.clearActiveChat(`${reason}:hidden`);
  }

  private isDocumentVisible(): boolean {
    if (typeof document === 'undefined') {
      return true;
    }

    return document.visibilityState === 'visible';
  }
}
