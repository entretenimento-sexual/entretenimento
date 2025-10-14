// src/app/app.component.spec.ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { Component } from '@angular/core';

import { AppComponent } from './app.component';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';

@Component({ template: '' })
class DummyComponent { }

describe('AppComponent', () => {
  const orchestratorStub = { start: jest.fn() };
  const authDebugStub = { start: jest.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: 'home', component: DummyComponent },
          { path: 'chat/:id', component: DummyComponent },
        ]),
      ],
      declarations: [AppComponent, DummyComponent],
      providers: [
        { provide: AuthOrchestratorService, useValue: orchestratorStub },
        { provide: AuthDebugService, useValue: authDebugStub },
      ],
    }).compileComponents();

    document.documentElement.className = '';
    document.body.className = '';
    localStorage.clear();
  });

  afterEach(() => jest.clearAllMocks());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it(`should have title 'entretenimento'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.title).toBe('entretenimento');
  });

  it('ngOnInit should start orchestrator and toggle footer class on navigation', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    // dispara ngOnInit e subscrição do router.events
    fixture.detectChanges();

    expect(orchestratorStub.start).toHaveBeenCalled();

    // rota NON-chat => footer visível
    router.navigateByUrl('/home');
    tick();
    expect(document.body.classList.contains('show-footer')).toBe(true);

    // rota de chat => footer oculto
    router.navigateByUrl('/chat/abc');
    tick();
    expect(document.body.classList.contains('show-footer')).toBe(false);
  }));
});
