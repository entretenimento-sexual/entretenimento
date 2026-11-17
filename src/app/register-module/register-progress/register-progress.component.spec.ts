import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { RegisterProgressComponent } from './register-progress.component';

describe('RegisterProgressComponent', () => {
  it.each([
    ['signup', 1, 'Conta', 'Confirmar seu e-mail'],
    ['emailVerification', 2, 'E-mail', 'Revisar e aceitar os termos'],
    ['termsAcceptance', 3, 'Termos', 'Confirmar sua maioridade'],
    ['ageVerification', 4, '18+', 'Completar seu perfil'],
    ['profileCompletion', 5, 'Perfil', undefined],
  ])('exibe a etapa %s e o próximo passo', (step, position, label, next) => {
    const fixture = TestBed.createComponent(RegisterProgressComponent);
    fixture.componentRef.setInput('step', step);
    fixture.detectChanges();

    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe(`Etapa ${position} de 5`);
    expect(view.querySelector('[aria-current="step"]')?.textContent).toContain(label);
    expect(view.querySelectorAll('.stage--done')).toHaveLength(position - 1);
    expect(view.querySelector('.next strong')?.textContent?.trim()).toBe(next);
  });

  it('mantém a confirmação visível enquanto a próxima tela ainda não abriu', () => {
    const fixture = TestBed.createComponent(RegisterProgressComponent);
    fixture.componentRef.setInput('step', 'emailVerification');
    fixture.componentRef.setInput('completed', true);
    fixture.detectChanges();

    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('2 de 5 etapas concluídas');
    expect(view.querySelectorAll('.stage--done')).toHaveLength(2);
    expect(view.querySelector('[aria-current="step"]')).toBeNull();

    fixture.componentRef.setInput('step', 'profileCompletion');
    fixture.detectChanges();
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('Cadastro concluído');
    expect(view.querySelectorAll('.stage--done')).toHaveLength(5);
  });
});
