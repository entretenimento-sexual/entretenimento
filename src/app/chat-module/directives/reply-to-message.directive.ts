// src/app/chat-module/directives/reply-to-message.directive.ts
import { Directive, HostListener, Input } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

export interface ChatReplySelectedEventDetail {
  messageId: string | null;
  senderName: string;
  excerpt: string;
  quotePrefix: string;
}

@Directive({
  selector: 'button[appReplyToMessage]',
  standalone: false,
})
export class ReplyToMessageDirective {
  @Input() appReplyToMessage: Message | null | undefined;
  @Input() replySenderName: string | null | undefined;

  @HostListener('click', ['$event'])
  onClick(event: Event): void {
    event.stopPropagation();

    if (this.appReplyToMessage?.deleted === true || typeof window === 'undefined') {
      return;
    }

    const content = String(this.appReplyToMessage?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!content) {
      return;
    }

    const senderName = String(this.replySenderName ?? this.appReplyToMessage?.nickname ?? 'Usuário')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 36) || 'Usuário';

    const excerpt = content.slice(0, 110);
    const detail: ChatReplySelectedEventDetail = {
      messageId: String(this.appReplyToMessage?.id ?? '').trim() || null,
      senderName,
      excerpt,
      quotePrefix: `> ${senderName}: ${excerpt}\n\n`,
    };

    window.dispatchEvent(new CustomEvent<ChatReplySelectedEventDetail>('chatReplySelected', { detail }));
  }
}
