// src/app/chat-module/directives/reply-to-message.directive.ts
// -----------------------------------------------------------------------------
// ReplyToMessageDirective
// -----------------------------------------------------------------------------
// Dispara um evento DOM com o contexto mínimo para responder uma mensagem.
//
// Decisão:
// - diretiva isolada para não inflar ChatMessageComponent;
// - evento DOM borbulhante para o layout capturar sem acoplar componentes;
// - primeira versão usa citação textual persistente, sem alterar backend.
// -----------------------------------------------------------------------------

import { Directive, ElementRef, HostListener, Input, inject } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

export type ChatReplyMessageDetail = {
  messageId: string | null;
  senderName: string;
  content: string;
};

@Directive({
  selector: 'button[appReplyToMessage]',
  standalone: false,
})
export class ReplyToMessageDirective {
  private readonly elementRef = inject<ElementRef<HTMLButtonElement>>(ElementRef);

  @Input() appReplyToMessage: Message | null | undefined;
  @Input() replySenderName: string | null | undefined;

  @HostListener('click', ['$event'])
  onClick(event: Event): void {
    event.stopPropagation();

    const message = this.appReplyToMessage;
    const content = String(message?.content ?? '').trim();

    if (!content) {
      return;
    }

    const detail: ChatReplyMessageDetail = {
      messageId: String(message?.id ?? '').trim() || null,
      senderName: String(this.replySenderName ?? message?.nickname ?? 'Usuário').trim() || 'Usuário',
      content,
    };

    this.elementRef.nativeElement.dispatchEvent(
      new CustomEvent<ChatReplyMessageDetail>('chatReplyMessage', {
        bubbles: true,
        composed: true,
        detail,
      })
    );
  }
}
