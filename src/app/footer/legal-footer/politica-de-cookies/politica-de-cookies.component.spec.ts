import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  PLATFORM_LEGAL_MANIFEST,
} from '../../../core/services/compliance/platform-legal.constants';
import { PoliticaDeCookiesComponent } from './politica-de-cookies.component';

describe('PoliticaDeCookiesComponent', () => {
  let component: PoliticaDeCookiesComponent;
  let fixture: ComponentFixture<PoliticaDeCookiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoliticaDeCookiesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PoliticaDeCookiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renderiza a versão canônica da política de cookies', () => {
    expect(component.legalManifest.cookieNoticeVersion).toBe(
      PLATFORM_LEGAL_MANIFEST.cookieNoticeVersion
    );

    const text = String(
      fixture.nativeElement?.textContent ?? ''
    );

    expect(text).toContain('Política de Cookies e Tecnologias Similares');
    expect(text).toContain(PLATFORM_LEGAL_MANIFEST.cookieNoticeVersion);
  });

  it('não volta a ser um placeholder', () => {
    const text = String(
      fixture.nativeElement?.textContent ?? ''
    );

    expect(text).not.toContain('works!');
  });

  it('distingue tecnologias ativas de integrações apenas configuradas', () => {
    const text = String(
      fixture.nativeElement?.textContent ?? ''
    );

    expect(text).toContain('Google Analytics');
    expect(text).toContain('não inicializa Google Analytics');
    expect(text).toContain('reCAPTCHA v3');
    expect(text).toContain('Firebase Cloud Messaging');
    expect(text).toContain('Asaas');
  });
});
