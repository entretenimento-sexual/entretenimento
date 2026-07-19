import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountLifecycleDialogComponent } from './account-lifecycle-dialog.component';

describe('AccountLifecycleDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountLifecycleDialogComponent],
    }).compileComponents();
  });

  function create(intent: 'self_suspend' | 'self_delete' = 'self_delete') {
    const fixture = TestBed.createComponent(AccountLifecycleDialogComponent);
    fixture.componentRef.setInput('intent', intent);
    fixture.detectChanges();
    return fixture;
  }

  it('mantém o diálogo visível para tecnologias assistivas', () => {
    const fixture = create();
    const backdrop = fixture.nativeElement.querySelector(
      '.account-lifecycle-dialog-backdrop'
    ) as HTMLElement;
    const dialog = fixture.nativeElement.querySelector(
      '[role="dialog"]'
    ) as HTMLElement;

    expect(backdrop.getAttribute('aria-hidden')).toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'account-lifecycle-dialog-title'
    );
  });

  it('explica que a exclusão é uma solicitação com prazo de 24 horas', () => {
    const fixture = create('self_delete');

    expect(fixture.nativeElement.textContent).toContain('24 horas');
    expect(fixture.nativeElement.textContent).toContain('Solicitar exclusão');
  });

  it('bloqueia motivo acima do limite compartilhado com o backend', () => {
    const fixture = create('self_delete');
    const textarea = fixture.nativeElement.querySelector(
      'textarea'
    ) as HTMLTextAreaElement;
    const confirm = fixture.nativeElement.querySelector(
      '.account-lifecycle-dialog__actions .btn-danger'
    ) as HTMLButtonElement;

    textarea.value = 'a'.repeat(501);
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(confirm.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'no máximo 500 caracteres'
    );
  });

  it('normaliza o motivo antes de emitir a confirmação', () => {
    const fixture = create('self_suspend');
    const component = fixture.componentInstance;
    const emit = vi.spyOn(component.confirmed, 'emit');
    const textarea = fixture.nativeElement.querySelector(
      'textarea'
    ) as HTMLTextAreaElement;
    const confirm = fixture.nativeElement.querySelector(
      '.account-lifecycle-dialog__actions .btn-primary'
    ) as HTMLButtonElement;

    textarea.value = '  pausa pessoal  ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    confirm.click();

    expect(emit).toHaveBeenCalledWith({
      intent: 'self_suspend',
      reason: 'pausa pessoal',
    });
  });
});
