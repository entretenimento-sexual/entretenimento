// src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmacaoDialogComponent } from './confirmacao-dialog.component';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';

describe('ConfirmacaoDialogComponent', () => {
  let component: ConfirmacaoDialogComponent;
  let fixture: ComponentFixture<ConfirmacaoDialogComponent>;
  let dialogData: Record<string, unknown>;

  const render = (): void => {
    fixture = TestBed.createComponent(ConfirmacaoDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    dialogData = {};

    await TestBed.configureTestingModule({
      declarations: [ConfirmacaoDialogComponent],
      imports: [CommonModule, ConfirmationDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
      ],
    }).compileComponents();

    render();
  });

  it('mantém a API legada com rótulos seguros por padrão', () => {
    expect(component).toBeTruthy();
    expect(component.title).toBe('Confirmar ação');
    expect(component.message).toBe('Deseja continuar?');
    expect(component.cancelLabel).toBe('Cancelar');
    expect(component.confirmLabel).toBe('Confirmar');
  });

  it('renderiza o modal canônico preservando cancelamento antes da confirmação destrutiva', () => {
    fixture.destroy();

    Object.assign(dialogData, {
      title: 'Encerrar sala?',
      message: 'O histórico será preservado.',
      cancelLabel: 'Manter sala',
      confirmLabel: 'Encerrar',
      tone: 'danger',
    });

    render();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).map((button) => button.textContent?.trim());

    expect(component.isDanger).toBe(true);
    expect(fixture.nativeElement.querySelector('app-confirmation-dialog')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Encerrar sala?');
    expect(buttons).toEqual(['Manter sala', 'Encerrar']);
  });
});
