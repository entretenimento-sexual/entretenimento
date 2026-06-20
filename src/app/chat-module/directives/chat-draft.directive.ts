// src/app/chat-module/directives/chat-draft.directive.ts
// -----------------------------------------------------------------------------
// ChatDraftDirective
// -----------------------------------------------------------------------------
// Persiste rascunhos do composer por conversa no sessionStorage.
//
// Decisão:
// - sessionStorage, não Firestore: rascunho é privado do dispositivo/sessão;
// - chave por conversa: evita misturar textos entre chats/salas;
// - diretiva isolada: evita inflar ainda mais ChatModuleLayoutComponent.
// -----------------------------------------------------------------------------

import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { NgModel } from '@angular/forms';

@Directive({
  selector: 'textarea[appChatDraftKey]',
  standalone: false,
})
export class ChatDraftDirective implements OnChanges, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);
  private readonly ngModel = inject(NgModel, { optional: true });

  @Input() appChatDraftKey: string | null | undefined;

  private lastStorageKey: string | null = null;
  private restoredForKey: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appChatDraftKey']) {
      return;
    }

    this.persistCurrentDraft(this.lastStorageKey);
    this.lastStorageKey = this.resolveStorageKey();
    this.restoreDraftForCurrentKey();
  }

  ngOnDestroy(): void {
    this.persistCurrentDraft(this.lastStorageKey);
  }

  @HostListener('input')
  onInput(): void {
    this.persistCurrentDraft(this.resolveStorageKey());
  }

  @HostListener('blur')
  onBlur(): void {
    this.persistCurrentDraft(this.resolveStorageKey());
  }

  private restoreDraftForCurrentKey(): void {
    const storageKey = this.resolveStorageKey();

    if (!storageKey || this.restoredForKey === storageKey) {
      return;
    }

    const draft = this.safeRead(storageKey);
    this.restoredForKey = storageKey;

    if (!draft) {
      return;
    }

    const element = this.elementRef.nativeElement;

    if (element.value.trim()) {
      return;
    }

    element.value = draft;
    this.ngModel?.control.setValue(draft, {
      emitEvent: true,
      emitModelToViewChange: true,
      emitViewToModelChange: true,
    });
  }

  private persistCurrentDraft(storageKey: string | null): void {
    if (!storageKey) {
      return;
    }

    const value = this.elementRef.nativeElement.value ?? '';
    const trimmed = value.trim();

    try {
      if (!trimmed) {
        sessionStorage.removeItem(storageKey);
        return;
      }

      sessionStorage.setItem(storageKey, value);
    } catch {
      // storage indisponível não deve quebrar o chat.
    }
  }

  private resolveStorageKey(): string | null {
    const rawKey = String(this.appChatDraftKey ?? '').trim();

    if (!rawKey || rawKey.includes('undefined') || rawKey.includes('null')) {
      return null;
    }

    return `chat-draft:${rawKey}`;
  }

  private safeRead(storageKey: string): string | null {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }
}
