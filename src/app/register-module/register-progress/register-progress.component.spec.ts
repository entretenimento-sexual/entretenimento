import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import type { IUserDados } from '@core/interfaces/iuser-dados';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';

import { RegisterProgressComponent } from './register-progress.component';

describe('RegisterProgressComponent', () => {
  let user$: BehaviorSubject<Partial<IUserDados> | null>;
  beforeEach(() => {
    user$ = new BehaviorSubject<Partial<IUserDados> | null>(null);
    TestBed.configureTestingModule({ providers: [{ provide: CurrentUserStoreService, useValue: { user$ } }] });
  });

  it('atualiza o aviso de inatividade apenas para a conta da etapa', () => {
    const fixture = TestBed.createComponent(RegisterProgressComponent);
    fixture.componentRef.setInput('step', 'termsAcceptance');
    fixture.componentRef.setInput('ownerUid', 'owner');
    const review = { stage: 'termsPending' as const, activityAtMs: 1, reviewAfterMs: Date.UTC(2026, 10, 25, 15) };
    user$.next({
      uid: 'owner', profileCompleted: false,
      registrationAbandonment: { ...review, status: 'resume_window' },
    });
    fixture.detectChanges();
    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('[role="status"]')?.textContent).toContain('25/11/2026 12:00');
    user$.next({
      uid: 'owner', profileCompleted: false,
      registrationAbandonment: { ...review, status: 'review_ready' },
    });
    fixture.detectChanges();
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Você ainda pode continuar');
    fixture.componentRef.setInput('step', 'profileCompletion');
    fixture.detectChanges();
    expect(view.querySelector('[role="status"]')).toBeNull();
    fixture.componentRef.setInput('step', 'termsAcceptance');
    user$.next({ ...user$.value, uid: 'other' });
    fixture.detectChanges();
    expect(view.querySelector('[role="status"]')).toBeNull();
  });
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
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe(
      step === 'profileCompletion' ? 'Última etapa' : `Etapa ${position} de 5`
    );
    expect(view.querySelector('[aria-current="step"]')?.textContent).toContain(label);
    expect(view.querySelectorAll('.stage--done')).toHaveLength(position - 1);
    expect(view.querySelector('.next strong')?.textContent?.trim()).toBe(next);
  });

  it('exibe a declaração 18+ antes da senha e dos termos no cadastro por link', () => {
    const fixture = TestBed.createComponent(RegisterProgressComponent);
    fixture.componentRef.setInput('emailLinkFlow', true);
    fixture.componentRef.setInput('step', 'emailVerification');
    fixture.detectChanges();

    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('Etapa 1 de 5');
    expect(view.querySelector('.next strong')?.textContent).toBe('Confirmar sua maioridade');
    fixture.componentRef.setInput('step', 'ageVerification');
    fixture.detectChanges();

    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('Etapa 2 de 5');
    expect(view.querySelector('[aria-current="step"]')?.textContent).toContain('18+');
    expect(view.querySelector('.next strong')?.textContent).toBe('Definir sua senha');
    fixture.componentRef.setInput('step', 'passwordSetup');
    fixture.detectChanges();

    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('Etapa 3 de 5');
    expect(view.querySelector('[aria-current="step"]')?.textContent).toContain('Senha');
    expect(view.querySelector('.next strong')?.textContent).toBe('Revisar e aceitar os termos');
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

  it('mostra a próxima tela dentro da etapa atual quando o cadastro a informa', () => {
    const fixture = TestBed.createComponent(RegisterProgressComponent);
    fixture.componentRef.setInput('step', 'signup');
    fixture.componentRef.setInput('nextAction', 'Configure seu acesso');
    fixture.detectChanges();

    const view: HTMLElement = fixture.nativeElement;
    expect(view.querySelector('.summary')?.textContent?.trim()).toBe('Etapa 1 de 5');
    expect(view.querySelector('.next strong')?.textContent).toBe('Configure seu acesso');

    fixture.componentRef.setInput('nextAction', null);
    fixture.detectChanges();
    expect(view.querySelector('.next strong')?.textContent).toBe('Confirmar seu e-mail');
  });
});
