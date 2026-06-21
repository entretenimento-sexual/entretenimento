// src/app/chat-module/directives/close-details-on-outside.directive.ts
// -----------------------------------------------------------------------------
// CloseDetailsOnOutsideDirective
// -----------------------------------------------------------------------------
// Fecha um <details> quando o usuário clica fora ou pressiona Escape.
//
// Uso no chat:
// - menu contextual da mensagem;
// - evita painel aberto perdido na tela;
// - melhora mobile e desktop sem depender de biblioteca externa.
// -----------------------------------------------------------------------------

import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({
  selector: 'details[appCloseDetailsOnOutside]',
  standalone: false,
})
export class CloseDetailsOnOutsideDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLDetailsElement>>(ElementRef);

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    const details = this.elementRef.nativeElement;

    if (!details.open) {
      return;
    }

    const target = event.target as Node | null;

    if (target && details.contains(target)) {
      return;
    }

    details.open = false;
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }

    const details = this.elementRef.nativeElement;

    if (!details.open) {
      return;
    }

    details.open = false;
    details.querySelector<HTMLElement>('summary')?.focus();
  };

  ngOnInit(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('keydown', this.handleDocumentKeydown, true);
  }

  ngOnDestroy(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('keydown', this.handleDocumentKeydown, true);
  }
}
