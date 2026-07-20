// src/app/shared/form-validation-focus/form-validation-focus.directive.ts
// -----------------------------------------------------------------------------
// FORM VALIDATION FOCUS DIRECTIVE
// -----------------------------------------------------------------------------
// Centraliza o feedback acessível de formulários reativos inválidos:
// - marca todos os controles como tocados;
// - anuncia a quantidade de campos que exigem revisão;
// - move o foco para o primeiro controle inválido;
// - mantém a regra de domínio e o submit no componente consumidor.
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
} from '@angular/forms';

@Directive({
  selector: 'form[appFormValidationFocus]',
  standalone: true,
})
export class FormValidationFocusDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLFormElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly formGroupDirective = inject(FormGroupDirective);

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
    const form = this.formGroupDirective.control;
    form.markAllAsTouched();
    form.updateValueAndValidity();

    if (form.valid) {
      this.clearAnnouncement();
      return;
    }

    this.focusFirstInvalid();
  }

  focusFirstInvalid(message = this.formInvalidMessage): boolean {
    const form = this.formGroupDirective.control;
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

    const firstControlName = this.findFirstInvalidControlName(form);
    this.scheduleFocus(firstControlName);
    return true;
  }

  focusControl(controlName: string, message = this.formInvalidMessage): boolean {
    const normalizedName = String(controlName ?? '').trim();
    if (!normalizedName) return false;

    this.announce(message);
    this.scheduleFocus(normalizedName);
    return true;
  }

  private scheduleFocus(controlName: string | null): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);

    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      const target = this.findControlElement(controlName);

      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const formElement = this.host.nativeElement;
      if (!formElement.hasAttribute('tabindex')) {
        this.renderer.setAttribute(formElement, 'tabindex', '-1');
      }
      formElement.focus({ preventScroll: true });
      formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
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

  private findFirstInvalidControlName(
    control: AbstractControl,
    currentName: string | null = null
  ): string | null {
    if (control.disabled || control.valid) return null;

    if (control instanceof FormGroup) {
      for (const [name, child] of Object.entries(control.controls)) {
        const result = this.findFirstInvalidControlName(child, name);
        if (result) return result;
      }
      return currentName;
    }

    if (control instanceof FormArray) {
      for (const child of control.controls) {
        const result = this.findFirstInvalidControlName(child, currentName);
        if (result) return result;
      }
      return currentName;
    }

    return currentName;
  }

  private countInvalidControls(control: AbstractControl): number {
    if (control.disabled || control.valid) return 0;

    if (control instanceof FormGroup) {
      return Object.values(control.controls).reduce(
        (total, child) => total + this.countInvalidControls(child),
        0
      );
    }

    if (control instanceof FormArray) {
      return control.controls.reduce(
        (total, child) => total + this.countInvalidControls(child),
        0
      );
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
