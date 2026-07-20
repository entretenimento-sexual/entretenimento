import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionRegistryService } from 'src/app/core/services/action-state/action-registry.service';
import { ActionStateDirective } from './action-state.directive';

@Component({
  standalone: true,
  imports: [ActionStateDirective],
  template: `
    <button
      type="button"
      [appActionState]="pending"
      [actionDisabled]="disabled"
      [actionKey]="actionKey"
      [actionPendingText]="pendingText"
    >
      Confirmar
    </button>
  `,
})
class TestHostComponent {
  pending = false;
  disabled = false;
  actionKey = '';
  pendingText = '';
}

describe('ActionStateDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let registry: ActionRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
    });

    registry = TestBed.inject(ActionRegistryService);
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

  it('observa ação registrada e restaura o texto estático ao concluir', () => {
    fixture.componentInstance.actionKey = 'room-close:r1';
    fixture.componentInstance.pendingText = 'Excluindo...';
    fixture.detectChanges();

    const source = new Subject<void>();
    const subscription = registry
      .track$('room-close:r1', () => source)
      .subscribe();
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.textContent?.trim()).toBe('Excluindo...');

    source.complete();
    fixture.detectChanges();

    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Confirmar');
    subscription.unsubscribe();
  });
});
