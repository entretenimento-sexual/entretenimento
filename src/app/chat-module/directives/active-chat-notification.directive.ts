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
// - centralizar decisão de notificação no serviço correto.
//
// SUPRESSÃO EXPLÍCITA:
// - não registra rooms nesta etapa.
//
// Motivo:
// - o problema relatado está no chat direto 1:1;
// - salas têm semântica diferente de unread/notificação e devem ter regra própria.
// -----------------------------------------------------------------------------

import { Directive, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

@Directive({
  selector: '[appActiveChatNotification]',
  standalone: false,
})
export class ActiveChatNotificationDirective implements OnChanges, OnDestroy {
  private readonly chatNotification = inject(ChatNotificationService);

  @Input() appActiveChatNotification: string | null | undefined;

  private registeredChatId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appActiveChatNotification']) {
      return;
    }

    const nextChatId = String(this.appActiveChatNotification ?? '').trim() || null;

    if (nextChatId === this.registeredChatId) {
      return;
    }

    this.registeredChatId = nextChatId;
    this.chatNotification.setActiveChat(nextChatId, 'active-chat-directive');
  }

  ngOnDestroy(): void {
    this.chatNotification.clearActiveChat('active-chat-directive-destroy');
    this.registeredChatId = null;
  }
}
