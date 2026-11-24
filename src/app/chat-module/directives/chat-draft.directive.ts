import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
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

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appChatDraftKey']) return;
    this.purgeLegacyDrafts();
    const nextKey = this.resolveStorageKey();
    if (this.lastStorageKey === nextKey) return;
    this.lastStorageKey = nextKey;
    this.clearComposer();
  }

  ngOnDestroy(): void {
    this.clearComposer();
    this.purgeLegacyDrafts();
  }

  private clearComposer(): void {
    this.elementRef.nativeElement.value = '';
    this.ngModel?.control.setValue('', {
      emitEvent: false,
      emitModelToViewChange: true,
      emitViewToModelChange: true,
    });
  }

  private resolveStorageKey(): string | null {
    const key = this.appChatDraftKey;
    return typeof key === 'string' && key.trim() ? key : null;
  }

  private purgeLegacyDrafts(): void {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith('chat-draft:')) sessionStorage.removeItem(key);
      }
    } catch {
      // Legacy storage may be inaccessible; never read or restore its content.
    }
  }
}
