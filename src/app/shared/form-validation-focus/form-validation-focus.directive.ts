// src/app/shared/form-validation-focus/form-validation-focus.directive.ts
// -----------------------------------------------------------------------------
// FORM VALIDATION FOCUS DIRECTIVE
// -----------------------------------------------------------------------------
// Centraliza o feedback acessível de formulários inválidos:
// - suporta formulários reativos e template-driven explicitamente marcados;
// - marca todos os controles como tocados;
// - anuncia a quantidade de campos que exigem revisão;
// - move o foco para o primeiro controle inválido na ordem visual do DOM;
// - mantém a regra de domínio e o submit no componente consumidor.
//
// A diretiva é aplicada automaticamente a forms reativos e a forms com o
// atributo `ngForm` nos módulos que a importam. Isso evita implementações
// divergentes entre cadastro, perfil e chat.
// -----------------------------------------------------------------------------
import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  Renderer2,
  inject,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormGroup,
  FormGroupDirective,
  NgForm,
} from '@angular/forms';

@Directive({
  selector: 'form[formGroup], form[ngForm]',
  standalone: true,
})
export class FormValidationFocusDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLFormElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly formGroupDirective = inject(FormGroupDirective, {
    optional: true,
    self: true,
  });
  private readonly ngForm = inject(NgForm, {
    optional: true,
    self: true,
  });

  private liveRegion: HTMLElement | null = null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  @Input() formInvalidMessage = 'Revise os campos destacados antes de continuar.';

  ngAfterViewInit(): void {
    this.liveRegion = this.renderer.createElement('div') as HTMLElement;
    this.renderer.setAttribute(this.liveRegion, 'role', 'alert');
    this.renderer.setAttribute(this.liveRegion, 'aria-live', 'assertive');
    this.renderer.setAttribute(this.liveRegion, 'aria-atomic', 'true');
    this.renderer.setAttribute(this.liveRegion, 'data-form-validation-summary', '');
    this.renderer.setStyle(this.liveRegion, 'position', 'absolute');
    this.renderer.setStyle(this.liveRegion, 'width', '1px');
    this.renderer.setStyle(this.liveRegion, 'height', '1px');
    this.renderer.setStyle(this.liveRegion, 'padding', '0');
    this.renderer.setStyle(this.liveRegion, 'margin', '-1px');
    this.renderer.setStyle(this.liveRegion, 'overflow', 'hidden');
    this.renderer.setStyle(this.liveRegion, 'clip', 'rect(0, 0, 0, 0)');
    this.renderer.setStyle(this.liveRegion, 'white-space', 'nowrap');
    this.renderer.setStyle(this.liveRegion, 'border', '0');
    this.renderer.appendChild(this.host.nativeElement, this.liveRegion);
  }

  ngOnDestroy(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }

    if (this.liveRegion?.parentNode) {
      this.renderer.removeChild(this.liveRegion.parentNode, this.liveRegion);
    }
    this.liveRegion = null;
  }

  @HostListener('submit')
  onNativeSubmit(): void {
    const form = this.getFormControl();
    if (!form) return;

    form.markAllAsTouched();
    form.updateValueAndValidity();

    if (form.valid) {
      this.clearAnnouncement();
      return;
    }

    this.focusFirstInvalid();
  }

  focusFirstInvalid(message = this.formInvalidMessage): boolean {
    const form = this.getFormControl();
    if (!form) return false;

    form.markAllAsTouched();
    form.updateValueAndValidity();

    const invalidCount = this.countInvalidControls(form);
    if (invalidCount === 0) {
      this.clearAnnouncement();
      return false;
    }

    const countLabel = invalidCount === 1
      ? '1 campo precisa de revisão.'
      : `${invalidCount} campos precisam de revisão.`;
    this.announce(`${countLabel} ${message}`);

    // A ordem de registro do FormGroup/NgForm pode divergir da ordem visual,
    // especialmente quando controles são inseridos por @if. A navegação por
    // erro deve seguir a ordem do DOM, que é a ordem percebida pelo usuário.
    this.scheduleFocus(null);
    return true;
  }

  focusControl(controlName: string, message = this.formInvalidMessage): boolean {
    const normalizedName = String(controlName ?? '').trim();
    if (!normalizedName) return false;

    this.announce(message);
    this.scheduleFocus(normalizedName);
    return true;
  }

  private getFormControl(): FormGroup | null {
    return this.formGroupDirective?.control ?? this.ngForm?.form ?? null;
  }

  private scheduleFocus(controlName: string | null): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);

    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      const target = this.findControlElement(controlName);

      if (target) {
        target.focus({ preventScroll: true });
        this.scrollElementIntoView(target, 'center');
        return;
      }

      const formElement = this.host.nativeElement;
      if (!formElement.hasAttribute('tabindex')) {
        this.renderer.setAttribute(formElement, 'tabindex', '-1');
      }
      formElement.focus({ preventScroll: true });
      this.scrollElementIntoView(formElement, 'start');
    }, 0);
  }

  private scrollElementIntoView(
    element: HTMLElement,
    block: ScrollLogicalPosition
  ): void {
    if (typeof element.scrollIntoView !== 'function') return;
    element.scrollIntoView({ behavior: 'smooth', block });
  }

  private findControlElement(controlName: string | null): HTMLElement | null {
    const root = this.host.nativeElement;
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[formControlName], input[name], select[name], textarea[name], [id]'
      )
    );

    if (controlName) {
      const exact = controls.find((element) =>
        element.getAttribute('formControlName') === controlName ||
        element.getAttribute('name') === controlName ||
        element.id === controlName
      );
      if (exact && !this.isUnavailable(exact)) return exact;
    }

    return controls.find((element) =>
      !this.isUnavailable(element) &&
      (
        element.getAttribute('aria-invalid') === 'true' ||
        element.classList.contains('ng-invalid')
      )
    ) ?? null;
  }

  private isUnavailable(element: HTMLElement): boolean {
    const control = element as HTMLInputElement;
    return control.disabled || element.getAttribute('aria-hidden') === 'true';
  }

  private countInvalidControls(control: AbstractControl): number {
    if (control.disabled || control.valid) return 0;

    if (control instanceof FormGroup) {
      const childCount = Object.keys(control.controls).reduce(
        (total, name) => total + this.countInvalidControls(control.controls[name]),
        0
      );
      return childCount || (control.errors ? 1 : 0);
    }

    if (control instanceof FormArray) {
      const childCount = control.controls.reduce(
        (total, child) => total + this.countInvalidControls(child),
        0
      );
      return childCount || (control.errors ? 1 : 0);
    }

    return 1;
  }

  private announce(message: string): void {
    if (!this.liveRegion) return;
    this.renderer.setProperty(this.liveRegion, 'textContent', '');
    setTimeout(() => {
      if (this.liveRegion) {
        this.renderer.setProperty(this.liveRegion, 'textContent', message);
      }
    }, 0);
  }

  private clearAnnouncement(): void {
    if (this.liveRegion) {
      this.renderer.setProperty(this.liveRegion, 'textContent', '');
    }
  }
}
