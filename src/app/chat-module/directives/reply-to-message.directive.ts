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

    if (this.appReplyToMessage?.deleted === true || typeof document === 'undefined') {
      return;
    }

    const content = String(this.appReplyToMessage?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!content) {
      return;
    }

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[appChatEmojiComposer]');

    if (!textarea) {
      return;
    }

    const senderName = String(this.replySenderName ?? this.appReplyToMessage?.nickname ?? 'Usuário')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 36) || 'Usuário';

    const excerpt = content.slice(0, 110);
    const quotePrefix = `> ${senderName}: ${excerpt}\n\n`;

    textarea.dataset['replyQuotePrefix'] = quotePrefix;
    this.renderReplyPreview(textarea, senderName, excerpt);
    this.ensureComposerPatch(textarea);

    globalThis.setTimeout(() => {
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }

  private renderReplyPreview(textarea: HTMLTextAreaElement, senderName: string, excerpt: string): void {
    const composerFooter = textarea.closest<HTMLElement>('.chat-shell__input');
    const composerMain = textarea.closest<HTMLElement>('.chat-shell__composer-main');

    if (!composerFooter || !composerMain) {
      return;
    }

    this.clearReplyPreview(textarea);

    const preview = document.createElement('div');
    preview.className = 'chat-shell__reply-preview';
    preview.dataset['chatReplyPreview'] = 'true';
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-live', 'polite');
    preview.setAttribute('aria-label', `Respondendo a ${senderName}`);

    const copy = document.createElement('div');
    copy.className = 'chat-shell__reply-preview-copy';

    const title = document.createElement('strong');
    title.className = 'chat-shell__reply-preview-title';
    title.textContent = `Respondendo a ${senderName}`;

    const text = document.createElement('span');
    text.className = 'chat-shell__reply-preview-text';
    text.textContent = excerpt;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'chat-shell__reply-preview-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cancelar resposta');

    close.addEventListener('click', () => {
      this.clearReplyPreview(textarea);
      textarea.focus();
    });

    copy.append(title, text);
    preview.append(copy, close);
    composerFooter.insertBefore(preview, composerMain);
  }

  private ensureComposerPatch(textarea: HTMLTextAreaElement): void {
    if (textarea.dataset['replyPatchReady'] === 'true') {
      return;
    }

    textarea.dataset['replyPatchReady'] = 'true';

    const applyQuote = (): void => {
      const quotePrefix = textarea.dataset['replyQuotePrefix'];
      const currentValue = String(textarea.value ?? '').trim();

      if (!quotePrefix || !currentValue || currentValue.startsWith(quotePrefix.trim())) {
        return;
      }

      textarea.value = `${quotePrefix}${currentValue}`;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      this.clearReplyPreview(textarea);
    };

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        applyQuote();
      }

      if (event.key === 'Escape') {
        this.clearReplyPreview(textarea);
      }
    }, true);

    const sendButton = textarea.closest<HTMLElement>('.chat-shell__input')
      ?.querySelector<HTMLButtonElement>('.chat-shell__send');

    sendButton?.addEventListener('click', () => {
      applyQuote();
    }, true);

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;

      if (!target) {
        return;
      }

      const clickedComposer = !!target.closest('.chat-shell__input');
      const clickedMessageAction = !!target.closest('[appReplyToMessage]');
      const clickedChatList = !!target.closest('app-chat-list');
      const clickedRoom = !!target.closest('app-room-interaction');

      if (!clickedComposer && !clickedMessageAction && (clickedChatList || clickedRoom)) {
        this.clearReplyPreview(textarea);
      }
    }, true);
  }

  private clearReplyPreview(textarea: HTMLTextAreaElement): void {
    delete textarea.dataset['replyQuotePrefix'];
    textarea.closest<HTMLElement>('.chat-shell__input')
      ?.querySelector('[data-chat-reply-preview="true"]')
      ?.remove();
  }
}
