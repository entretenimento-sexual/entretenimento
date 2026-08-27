import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from './confirmation-dialog.component';

describe('ConfirmationDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmationDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  const data: Omit<ConfirmationDialogData, 'tone'> & { tone: 'default' } = {
    title: 'Desfazer conexão?',
    message: 'Você deixará de estar conectado com Perfil teste.',
    detail: 'O histórico existente será mantido.',
    cancelLabel: 'Manter conexão',
    confirmLabel: 'Desfazer conexão',
    tone: 'default',
  };

  beforeEach(async () => {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ConfirmationDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationDialogComponent);
    fixture.detectChanges();
  });

  it('normaliza tone legado default para warning', () => {
    expect(fixture.componentInstance.tone()).toBe('warning');
    expect(
      fixture.nativeElement.querySelector('.confirmation-dialog')?.getAttribute('data-tone')
    ).toBe('warning');
  });

  it('mantém mensagem e detalhe na descrição acessível', () => {
    const dialog = fixture.nativeElement.querySelector('.confirmation-dialog') as HTMLElement;

    expect(dialog.getAttribute('aria-describedby')).toBe(
      'confirmation-dialog-message confirmation-dialog-detail'
    );
    expect(fixture.nativeElement.textContent).toContain('Perfil teste');
    expect(fixture.nativeElement.textContent).toContain('O histórico existente será mantido.');
  });

  it('cancela por padrão e confirma somente pela ação explícita', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

    buttons[0].click();
    expect(close).toHaveBeenLastCalledWith(false);

    buttons[1].click();
    expect(close).toHaveBeenLastCalledWith(true);
  });
});
