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

    composerFooter.querySelector('[data-chat-reply-preview="true"]')?.remove();

    const preview = document.createElement('div');
    preview.dataset['chatReplyPreview'] = 'true';
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-live', 'polite');
    preview.setAttribute('aria-label', `Respondendo a ${senderName}`);

    preview.style.display = 'grid';
    preview.style.gridTemplateColumns = 'minmax(0, 1fr) 34px';
    preview.style.gap = '10px';
    preview.style.alignItems = 'center';
    preview.style.width = '100%';
    preview.style.boxSizing = 'border-box';
    preview.style.padding = '9px 10px';
    preview.style.border = '1px solid color-mix(in oklab, var(--primary-color) 24%, var(--surface-border))';
    preview.style.borderLeft = '4px solid color-mix(in oklab, var(--primary-color) 72%, var(--surface-border))';
    preview.style.borderRadius = '14px';
    preview.style.background = 'color-mix(in oklab, var(--primary-color) 7%, var(--surface-color))';
    preview.style.color = 'var(--text-color)';

    const copy = document.createElement('div');
    copy.style.minWidth = '0';
    copy.style.display = 'grid';
    copy.style.gap = '2px';

    const title = document.createElement('strong');
    title.textContent = `Respondendo a ${senderName}`;
    title.style.maxWidth = '100%';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';
    title.style.color = 'color-mix(in oklab, var(--primary-color) 72%, var(--text-color))';
    title.style.fontSize = '0.78rem';
    title.style.lineHeight = '1.15';
    title.style.fontWeight = '900';

    const text = document.createElement('span');
    text.textContent = excerpt;
    text.style.maxWidth = '100%';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.whiteSpace = 'nowrap';
    text.style.color = 'color-mix(in oklab, var(--text-color) 66%, transparent)';
    text.style.fontSize = '0.82rem';
    text.style.lineHeight = '1.2';
    text.style.fontWeight = '650';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cancelar resposta');
    close.style.display = 'inline-grid';
    close.style.placeItems = 'center';
    close.style.width = '34px';
    close.style.height = '34px';
    close.style.border = '1px solid color-mix(in oklab, var(--surface-border) 70%, transparent)';
    close.style.borderRadius = '999px';
    close.style.background = 'color-mix(in oklab, var(--surface-color) 92%, var(--background-color))';
    close.style.color = 'var(--text-color)';
    close.style.font = 'inherit';
    close.style.fontSize = '1.2rem';
    close.style.lineHeight = '1';
    close.style.cursor = 'pointer';

    close.addEventListener('click', () => {
      delete textarea.dataset['replyQuotePrefix'];
      preview.remove();
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
      textarea.closest<HTMLElement>('.chat-shell__input')
        ?.querySelector('[data-chat-reply-preview="true"]')
        ?.remove();
      delete textarea.dataset['replyQuotePrefix'];
    };

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        applyQuote();
      }
    }, true);

    const sendButton = textarea.closest<HTMLElement>('.chat-shell__input')
      ?.querySelector<HTMLButtonElement>('.chat-shell__send');

    sendButton?.addEventListener('click', () => {
      applyQuote();
    }, true);
  }
}
