// src/app/app.component.spec.ts
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

import { AppComponent } from './app.component';
import { AuthSessionExitService } from './core/services/autentication/auth/auth-session-exit.service';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { PresenceOrchestratorService } from './core/services/presence/presence-orchestrator.service';
import { PlatformSubscriptionAccessService } from './core/services/subscriptions/platform-subscription-access.service';
import { RouterDiagnosticsService } from './core/services/util-service/router-diagnostics.service';
import { PlatformSubscriptionReconciliationService } from './payments-core/application/platform-subscription-reconciliation.service';

@Component({
  standalone: true,
  template: '',
})
class DummyComponent {}

describe('AppComponent', () => {
  let router: Router;

  const exitStub = {
    start: vi.fn(),
    pending$: new BehaviorSubject<string | null>(null),
    loginFailed$: new BehaviorSubject(false),
    retryLogin: vi.fn(),
  };
  const orchestratorStub = { start: vi.fn() };
  const presenceOrchestratorStub = { start: vi.fn() };
  const subscriptionReconciliationStub = { start: vi.fn() };
  const subscriptionAccessStub = { start: vi.fn() };
  const authDebugStub = { start: vi.fn() };
  const routerDiagnosticsStub = { start: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();

    exitStub.pending$.next(null);
    exitStub.loginFailed$.next(false);
    document.documentElement.className = '';
    document.body.className = '';
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        DummyComponent,
        RouterTestingModule.withRoutes([
          { path: 'home', component: DummyComponent },
          { path: 'chat/:id', component: DummyComponent },
        ]),
      ],
      declarations: [AppComponent],
      providers: [
        { provide: AuthSessionExitService, useValue: exitStub },
        { provide: AuthOrchestratorService, useValue: orchestratorStub },
        {
          provide: PresenceOrchestratorService,
          useValue: presenceOrchestratorStub,
        },
        {
          provide: PlatformSubscriptionReconciliationService,
          useValue: subscriptionReconciliationStub,
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: subscriptionAccessStub,
        },
        { provide: AuthDebugService, useValue: authDebugStub },
        { provide: RouterDiagnosticsService, useValue: routerDiagnosticsStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it(`should have title 'entretenimento'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.title).toBe('entretenimento');
  });

  it('expõe um link de salto para o conteúdo roteado', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const skipLink = fixture.debugElement.query(By.css('.skip-link'))
      .nativeElement as HTMLAnchorElement;
    const target = fixture.debugElement.query(By.css('#route-content'))
      .nativeElement as HTMLElement;

    expect(skipLink.getAttribute('href')).toBe('#route-content');
    expect(skipLink.textContent?.trim()).toBe('Ir para o conteúdo principal');
    expect(target.getAttribute('tabindex')).toBe('-1');
  });

  it('oculta o outlet quando a tela protegida perde a sessão', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    exitStub.pending$.next('session-ended');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#route-content [hidden]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Abrindo a tela de login');
  });

  it('oferece acesso ao login se a navegação falhar depois do logout', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    exitStub.pending$.next('signed-out');
    exitStub.loginFailed$.next(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Sua sessão foi encerrada.');
    const retry = root.querySelector<HTMLButtonElement>('#route-content button')!;
    expect(retry.textContent).toContain('Abrir login');
    retry.click();
    expect(exitStub.retryLogin).toHaveBeenCalledOnce();
  });

  it('inicia orquestradores e assinatura canônica', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    fixture.detectChanges();

    expect(routerDiagnosticsStub.start).toHaveBeenCalledTimes(1);
    expect(exitStub.start).toHaveBeenCalledTimes(1);
    expect(orchestratorStub.start).toHaveBeenCalledTimes(1);
    expect(presenceOrchestratorStub.start).toHaveBeenCalledTimes(1);
    expect(subscriptionReconciliationStub.start).toHaveBeenCalledTimes(1);
    expect(subscriptionAccessStub.start).toHaveBeenCalledTimes(1);

    await fixture.ngZone!.run(() => router.navigateByUrl('/home'));
    fixture.detectChanges();
    await expect(firstValueFrom(component.showFooter$)).resolves.toBe(true);

    await fixture.ngZone!.run(() => router.navigateByUrl('/chat/abc'));
    fixture.detectChanges();
    await expect(firstValueFrom(component.showFooter$)).resolves.toBe(false);
  });
});
