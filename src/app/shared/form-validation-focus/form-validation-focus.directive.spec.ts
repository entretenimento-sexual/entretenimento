import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormValidationFocusDirective } from './form-validation-focus.directive';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormValidationFocusDirective],
  template: `
    <form
      [formGroup]="form"
      appFormValidationFocus
      formInvalidMessage="Corrija os campos para continuar."
      (ngSubmit)="submitted = true"
    >
      <input id="nickname" formControlName="nickname" />
      <input id="email" formControlName="email" />
      <button type="submit">Salvar</button>
    </form>
  `,
})
class TestHostComponent {
  readonly form = new FormGroup({
    nickname: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
  });
  submitted = false;
}

describe('FormValidationFocusDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('marca controles, anuncia erros e foca o primeiro inválido', () => {
    const nickname = fixture.debugElement.query(By.css('#nickname'))
      .nativeElement as HTMLInputElement;
    const focusSpy = vi.spyOn(nickname, 'focus');
    const scrollSpy = vi.spyOn(nickname, 'scrollIntoView');
    const form = fixture.debugElement.query(By.css('form'));

    form.triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();
    vi.runAllTimers();

    const summary = form.nativeElement.querySelector(
      '[data-form-validation-summary]'
    ) as HTMLElement;

    expect(fixture.componentInstance.form.controls.nickname.touched).toBe(true);
    expect(fixture.componentInstance.form.controls.email.touched).toBe(true);
    expect(summary.textContent).toContain('2 campos precisam de revisão');
    expect(summary.textContent).toContain('Corrija os campos para continuar');
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('não anuncia erro quando o formulário está válido', () => {
    fixture.componentInstance.form.setValue({
      nickname: 'alex',
      email: 'alex@example.com',
    });
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.css('form'));
    form.triggerEventHandler('submit', new Event('submit'));
    vi.runAllTimers();

    const summary = form.nativeElement.querySelector(
      '[data-form-validation-summary]'
    ) as HTMLElement;
    expect(summary.textContent).toBe('');
  });

  it('permite focar explicitamente um controle invalidado após o submit', () => {
    const directive = fixture.debugElement
      .query(By.directive(FormValidationFocusDirective))
      .injector.get(FormValidationFocusDirective);
    const email = fixture.debugElement.query(By.css('#email'))
      .nativeElement as HTMLInputElement;
    const focusSpy = vi.spyOn(email, 'focus');

    expect(directive.focusControl('email', 'Informe um e-mail válido.')).toBe(true);
    vi.runAllTimers();

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
