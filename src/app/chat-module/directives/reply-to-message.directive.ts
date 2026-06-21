// src/app/chat-module/directives/reply-to-message.directive.ts
import { Directive, HostListener, Input } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

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

    const content = String(this.appReplyToMessage?.content ?? '').trim();

    if (!content || typeof document === 'undefined') {
      return;
    }

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[appChatEmojiComposer]');

    if (!textarea) {
      return;
    }

    const senderName = String(this.replySenderName ?? this.appReplyToMessage?.nickname ?? 'Usuário')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 36);

    const excerpt = content
      .replace(/\s+/g, ' ')
      .slice(0, 110);

    const quote = `> ${senderName}: ${excerpt}\n\n`;
    const currentValue = textarea.value ?? '';
    textarea.value = currentValue.trim() ? `${quote}${currentValue}` : quote;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    window.setTimeout(() => {
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }
}
