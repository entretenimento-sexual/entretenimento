// src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfirmacaoDialogComponent } from './confirmacao-dialog.component';

describe('ConfirmacaoDialogComponent', () => {
  let component: ConfirmacaoDialogComponent;
  let fixture: ComponentFixture<ConfirmacaoDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ConfirmacaoDialogComponent],
      imports: [CommonModule],
      providers: [{ provide: MAT_DIALOG_DATA, useValue: {} }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmacaoDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve ser criado com rótulos seguros por padrão', () => {
    expect(component).toBeTruthy();
    expect(component.title).toBe('Confirmar ação');
    expect(component.message).toBe('Deseja continuar?');
    expect(component.cancelLabel).toBe('Cancelar');
    expect(component.confirmLabel).toBe('Confirmar');
  });

  it('apresenta cancelamento antes da confirmação destrutiva', () => {
    Object.assign(component.data, {
      title: 'Encerrar sala?',
      message: 'O histórico será preservado.',
      cancelLabel: 'Manter sala',
      confirmLabel: 'Encerrar',
      tone: 'danger',
    });
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).map((button) => button.textContent?.trim());

    expect(component.isDanger).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Encerrar sala?');
    expect(buttons).toEqual(['Manter sala', 'Encerrar']);
  });
});
