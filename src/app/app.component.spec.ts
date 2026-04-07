// src/app/app.component.spec.ts
import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

import { AppComponent } from './app.component';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { PresenceOrchestratorService } from './core/services/presence/presence-orchestrator.service';
import { RouterDiagnosticsService } from './core/services/util-service/router-diagnostics.service';

@Component({
  standalone: true,
  template: '',
})
class DummyComponent {}

describe('AppComponent', () => {
  let router: Router;

  const orchestratorStub = {
    start: vi.fn(),
  };

  const presenceOrchestratorStub = {
    start: vi.fn(),
  };

  const authDebugStub = {
    start: vi.fn(),
  };

  const routerDiagnosticsStub = {
    start: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

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
        { provide: AuthOrchestratorService, useValue: orchestratorStub },
        { provide: PresenceOrchestratorService, useValue: presenceOrchestratorStub },
        { provide: AuthDebugService, useValue: authDebugStub },
        { provide: RouterDiagnosticsService, useValue: routerDiagnosticsStub },
      ],
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

  it('ngOnInit should start orchestrators and toggle footer class on navigation', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);

    fixture.detectChanges();

    expect(routerDiagnosticsStub.start).toHaveBeenCalledTimes(1);
    expect(orchestratorStub.start).toHaveBeenCalledTimes(1);
    expect(presenceOrchestratorStub.start).toHaveBeenCalledTimes(1);

    fixture.ngZone!.run(() => {
      void router.navigateByUrl('/home');
    });
    tick();
    fixture.detectChanges();

    expect(document.body.classList.contains('show-footer')).toBe(true);

    fixture.ngZone!.run(() => {
      void router.navigateByUrl('/chat/abc');
    });
    tick();
    fixture.detectChanges();

    expect(document.body.classList.contains('show-footer')).toBe(false);
  }));
});
