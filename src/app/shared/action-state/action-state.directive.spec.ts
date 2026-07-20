import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, beforeEach } from 'vitest';

import { ActionStateDirective } from './action-state.directive';

@Component({
  standalone: true,
  imports: [ActionStateDirective],
  template: `
    <button
      type="button"
      [appActionState]="pending"
      [actionDisabled]="disabled"
    >
      Confirmar
    </button>
  `,
})
class TestHostComponent {
  pending = false;
  disabled = false;
}

describe('ActionStateDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('mantém o botão habilitado quando não há bloqueio', () => {
    const button = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('bloqueia e anuncia operação pendente', () => {
    fixture.componentInstance.pending = true;
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.classList.contains('app-action-state--pending')).toBe(true);
  });

  it('respeita bloqueio funcional sem anunciar carregamento', () => {
    fixture.componentInstance.disabled = true;
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});
