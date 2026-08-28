// src/app/chat-module/directives/chat-emoji-composer.directive.ts
// -----------------------------------------------------------------------------
// ChatEmojiComposerDirective
// -----------------------------------------------------------------------------
// Insere emojis no textarea do composer mantendo ngModel, posição do cursor e
// limite de caracteres.
//
// Decisão:
// - sem biblioteca externa para não aumentar bundle;
// - lógica isolada em diretiva para não inflar ChatModuleLayoutComponent;
// - funciona junto com appChatDraftKey porque dispara evento input após inserir.
// -----------------------------------------------------------------------------

import { Directive, ElementRef, inject } from '@angular/core';
import { NgModel } from '@angular/forms';

@Directive({
  selector: 'textarea[appChatEmojiComposer]',
  exportAs: 'chatEmojiComposer',
  standalone: false,
})
export class ChatEmojiComposerDirective {
  private readonly elementRef = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);
  private readonly ngModel = inject(NgModel, { optional: true });

  insert(emoji: string): boolean {
    const safeEmoji = String(emoji ?? '').trim();

    if (!safeEmoji) {
      return false;
    }

    const textarea = this.elementRef.nativeElement;
    const currentValue = textarea.value ?? '';
    const selectionStart = textarea.selectionStart ?? currentValue.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const maxLength = this.resolveMaxLength(textarea);

    const nextValue =
      currentValue.slice(0, selectionStart) +
      safeEmoji +
      currentValue.slice(selectionEnd);

    if (maxLength !== null && nextValue.length > maxLength) {
      return false;
    }

    textarea.value = nextValue;
    this.ngModel?.control.setValue(nextValue, {
      emitEvent: true,
      emitModelToViewChange: true,
      emitViewToModelChange: true,
    });

    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const nextCursor = selectionStart + safeEmoji.length;

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    }, 0);

    return true;
  }

  private resolveMaxLength(textarea: HTMLTextAreaElement): number | null {
    const raw = textarea.getAttribute('maxlength');
    const value = Number.parseInt(String(raw ?? ''), 10);

    return Number.isFinite(value) && value > 0 ? value : null;
  }
}
