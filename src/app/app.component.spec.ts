// src/app/app.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AppComponent } from './app.component';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';

describe('AppComponent', () => {
  const orchestratorStub = { start: jest.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AppComponent],
      providers: [
        { provide: AuthOrchestratorService, useValue: orchestratorStub }, // ✅
      ],
    }).compileComponents();

    document.documentElement.className = '';
    document.body.className = '';
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it(`should have title 'entretenimento'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.title).toEqual('entretenimento');
  });

  it('toggleDarkMode should toggle class and persist theme', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(document.documentElement.classList.contains('dark-mode')).toBe(false);

    app.toggleDarkMode();
    expect(document.documentElement.classList.contains('dark-mode')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    app.toggleDarkMode();
    expect(document.documentElement.classList.contains('dark-mode')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('ngOnInit should set dark mode from localStorage when theme=dark', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('dark');
    const fixture = TestBed.createComponent(AppComponent);

    // chama ngOnInit manualmente (evita side-effects de detectChanges)
    fixture.componentInstance.ngOnInit();

    expect(document.documentElement.classList.contains('dark-mode')).toBe(true);
    // opcional: garante que o orchestrator foi chamado
    expect(orchestratorStub.start).toHaveBeenCalled();
  });
});
