import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormValidationFocusDirective } from './form-validation-focus.directive';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormValidationFocusDirective],
  template: `
    <form
      [formGroup]="form"
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
    nickname: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });
  submitted = false;
}

@Component({
  standalone: true,
  imports: [FormsModule, FormValidationFocusDirective],
  template: `
    <form
      ngForm
      #form="ngForm"
      formInvalidMessage="Revise o perfil antes de continuar."
    >
      <input
        id="template-nickname"
        name="nickname"
        [(ngModel)]="nickname"
        required
      />
      <select
        id="template-gender"
        name="gender"
        [(ngModel)]="gender"
        required
      >
        <option value="">Selecione...</option>
        <option value="homem">Homem</option>
      </select>
      <button type="submit">Concluir</button>
    </form>
  `,
})
class TemplateDrivenHostComponent {
  nickname = '';
  gender = '';
}

describe('FormValidationFocusDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [TestHostComponent, TemplateDrivenHostComponent],
    });
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marca controles, anuncia erros e foca o primeiro inválido', () => {
    const nickname = fixture.debugElement.query(By.css('#nickname'))
      .nativeElement as HTMLInputElement;
    const focusSpy = vi.spyOn(nickname, 'focus');
    const scrollSpy = vi.fn();
    Object.defineProperty(nickname, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });
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

  it('marca, anuncia e foca o primeiro campo inválido em formulário template-driven', async () => {
    const templateFixture = TestBed.createComponent(TemplateDrivenHostComponent);
    templateFixture.detectChanges();

    // NgForm registra controles ngModel em microtask. O submit do teste deve
    // reproduzir a interação real do usuário, que acontece após essa fase.
    await templateFixture.whenStable();
    templateFixture.detectChanges();

    const nickname = templateFixture.debugElement
      .query(By.css('#template-nickname'))
      .nativeElement as HTMLInputElement;
    const focusSpy = vi.spyOn(nickname, 'focus');
    const scrollSpy = vi.fn();
    Object.defineProperty(nickname, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    const form = templateFixture.debugElement.query(By.css('form'));
    form.triggerEventHandler('submit', new Event('submit'));
    templateFixture.detectChanges();
    vi.runAllTimers();

    const summary = form.nativeElement.querySelector(
      '[data-form-validation-summary]'
    ) as HTMLElement;

    expect(summary.textContent).toContain('2 campos precisam de revisão');
    expect(summary.textContent).toContain('Revise o perfil antes de continuar');
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    templateFixture.destroy();
  });
});
