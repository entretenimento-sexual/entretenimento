import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseModalComponent } from './base-modal.component';

describe('BaseModalComponent', () => {
  let fixture: ComponentFixture<BaseModalComponent>;
  let updateSizeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateSizeMock = vi.fn();

    await TestBed.configureTestingModule({
      imports: [BaseModalComponent],
      providers: [
        {
          provide: MatDialogRef,
          useValue: { updateSize: updateSizeMock },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BaseModalComponent);
    fixture.componentRef.setInput('title', 'Criar Sala');
    fixture.detectChanges();
  });

  it('normaliza o tamanho do painel para telas pequenas', () => {
    expect(updateSizeMock).toHaveBeenCalledWith('min(92vw, 40rem)');
  });

  it('associa o título ao shell semântico', () => {
    const shell = fixture.debugElement.query(By.css('.modal-shell'))
      .nativeElement as HTMLElement;
    const title = fixture.debugElement.query(By.css('h2'))
      .nativeElement as HTMLHeadingElement;

    expect(shell.getAttribute('role')).toBe('document');
    expect(shell.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent?.trim()).toBe('Criar Sala');
  });

  it('expõe botão de fechamento acessível e tipado', () => {
    const closeButton = fixture.debugElement.query(By.css('.close-btn'))
      .nativeElement as HTMLButtonElement;

    expect(closeButton.type).toBe('button');
    expect(closeButton.getAttribute('aria-label')).toBe('Fechar janela');
  });

  it('emite closeModal ao acionar o botão', () => {
    const closeSpy = vi.fn();
    fixture.componentInstance.closeModal.subscribe(closeSpy);

    fixture.debugElement.query(By.css('.close-btn')).triggerEventHandler(
      'click',
      null
    );

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
