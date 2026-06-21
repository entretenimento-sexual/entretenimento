// src/app/chat-module/directives/copy-message-text.directive.ts
// -----------------------------------------------------------------------------
// CopyMessageTextDirective
// -----------------------------------------------------------------------------
// Copia o conteúdo textual de uma mensagem do chat.
//
// Decisão:
// - diretiva isolada para não inflar ChatMessageComponent;
// - usa Clipboard API quando disponível;
// - mantém fallback para navegadores sem navigator.clipboard;
// - fornece estado visual por data-copy-state e classe ativa temporária.
// -----------------------------------------------------------------------------

import { Directive, HostBinding, HostListener, Input, OnDestroy } from '@angular/core';

type CopyState = 'idle' | 'copied' | 'error';

@Directive({
  selector: 'button[appCopyMessageText]',
  standalone: false,
})
export class CopyMessageTextDirective implements OnDestroy {
  @Input() appCopyMessageText: string | null | undefined;

  @HostBinding('attr.data-copy-state') copyState: CopyState = 'idle';

  @HostBinding('class.thread-message__reaction-button--active')
  get isCopied(): boolean {
    return this.copyState === 'copied';
  }

  @HostBinding('attr.aria-label')
  get ariaLabel(): string {
    if (this.copyState === 'copied') {
      return 'Mensagem copiada';
    }

    if (this.copyState === 'error') {
      return 'Não foi possível copiar a mensagem';
    }

    return 'Copiar mensagem';
  }

  private resetTimer: number | null = null;

  ngOnDestroy(): void {
    this.clearResetTimer();
  }

  @HostListener('click', ['$event'])
  async onClick(event: Event): Promise<void> {
    event.stopPropagation();

    const text = String(this.appCopyMessageText ?? '').trim();

    if (!text) {
      this.setState('error');
      return;
    }

    try {
      await this.copyText(text);
      this.setState('copied');
    } catch {
      this.setState('error');
    }
  }

  private async copyText(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    this.copyUsingTextarea(text);
  }

  private copyUsingTextarea(text: string): void {
    if (typeof document === 'undefined') {
      throw new Error('Clipboard indisponível');
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error('Falha ao copiar');
    }
  }

  private setState(state: CopyState): void {
    this.copyState = state;
    this.clearResetTimer();

    this.resetTimer = window.setTimeout(() => {
      this.copyState = 'idle';
      this.resetTimer = null;
    }, 1400);
  }

  private clearResetTimer(): void {
    if (this.resetTimer === null) {
      return;
    }

    window.clearTimeout(this.resetTimer);
    this.resetTimer = null;
  }
}
