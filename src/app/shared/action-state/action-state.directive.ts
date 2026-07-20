// src/app/shared/action-state/action-state.directive.ts
// -----------------------------------------------------------------------------
// ACTION STATE DIRECTIVE
// -----------------------------------------------------------------------------
// Padroniza o estado de botões e controles acionáveis durante operações
// assíncronas. A lógica de domínio continua responsável por iniciar/finalizar a
// operação; a diretiva somente garante bloqueio, semântica e feedback de estado.
//
// `actionPendingText` deve ser usado apenas quando o conteúdo interno do botão é
// estático. Componentes com conteúdo Angular dinâmico devem continuar renderizando
// o próprio label de progresso.
// -----------------------------------------------------------------------------
import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostBinding,
  Input,
  Renderer2,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { ActionRegistryService } from 'src/app/core/services/action-state/action-registry.service';

@Directive({
  selector: 'button[appActionState], input[appActionState]',
  standalone: true,
})
export class ActionStateDirective implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly registry = inject(ActionRegistryService);

  private readonly explicitPending = signal(false);
  private readonly explicitDisabled = signal(false);
  private readonly registryKey = signal('');
  private readonly pendingText = signal('');
  private readonly viewReady = signal(false);
  private readonly pendingKeys = toSignal(this.registry.pendingKeys$, {
    initialValue: new Set<string>() as ReadonlySet<string>,
  });

  private originalTextContent = '';
  private pendingTextApplied = false;

  readonly effectivePending = computed(() => {
    const key = this.registryKey();
    return this.explicitPending() || (!!key && this.pendingKeys().has(key));
  });

  readonly effectiveDisabled = computed(
    () => this.effectivePending() || this.explicitDisabled()
  );

  @Input('appActionState')
  set pending(value: boolean | null | undefined) {
    this.explicitPending.set(value === true);
  }

  @Input()
  set actionDisabled(value: boolean | null | undefined) {
    this.explicitDisabled.set(value === true);
  }

  @Input()
  set actionKey(value: string | null | undefined) {
    this.registryKey.set(String(value ?? '').trim().slice(0, 240));
  }

  @Input()
  set actionPendingText(value: string | null | undefined) {
    this.pendingText.set(String(value ?? '').trim().slice(0, 120));
  }

  @HostBinding('disabled')
  get disabled(): boolean {
    return this.effectiveDisabled();
  }

  @HostBinding('attr.aria-busy')
  get ariaBusy(): 'true' | null {
    return this.effectivePending() ? 'true' : null;
  }

  @HostBinding('attr.aria-disabled')
  get ariaDisabled(): 'true' | null {
    return this.effectiveDisabled() ? 'true' : null;
  }

  @HostBinding('class.app-action-state--pending')
  get pendingClass(): boolean {
    return this.effectivePending();
  }

  constructor() {
    effect(() => {
      const ready = this.viewReady();
      const pending = this.effectivePending();
      const pendingText = this.pendingText();

      if (!ready || !pendingText) return;

      if (pending) {
        this.renderer.setProperty(
          this.elementRef.nativeElement,
          'textContent',
          pendingText
        );
        this.pendingTextApplied = true;
        return;
      }

      if (this.pendingTextApplied) {
        this.renderer.setProperty(
          this.elementRef.nativeElement,
          'textContent',
          this.originalTextContent
        );
        this.pendingTextApplied = false;
      }
    });
  }

  ngAfterViewInit(): void {
    this.originalTextContent =
      this.elementRef.nativeElement.textContent?.trim() ?? '';
    this.viewReady.set(true);
  }
}
