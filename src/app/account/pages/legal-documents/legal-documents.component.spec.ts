import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { TERMS_ACCEPTANCE_VERSION } from '@core/services/compliance/terms-acceptance.service';
import { LegalDocumentsComponent } from './legal-documents.component';

class MockCurrentUserStoreService {
  readonly user$ = new BehaviorSubject<any>({
    uid: 'user-1',
    acceptedTerms: {
      accepted: true,
      version: TERMS_ACCEPTANCE_VERSION,
      acknowledgedPrivacyNotice: true,
      acceptedAt: 1785530197000,
    },
  });
}

describe('LegalDocumentsComponent', () => {
  let fixture: ComponentFixture<LegalDocumentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LegalDocumentsComponent],
      providers: [
        {
          provide: CurrentUserStoreService,
          useClass: MockCurrentUserStoreService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LegalDocumentsComponent);
    fixture.detectChanges();
  });

  it('exibe a situação do aceite atual sem solicitar nova confirmação', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Termos atuais aceitos');
    expect(text).toContain('não altera seu aceite');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('oferece os três documentos preservando a tela anterior', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.document-card')
    ) as HTMLAnchorElement[];

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/termos-e-condicoes',
      '/politica-de-privacidade',
      '/politica-de-cookies',
    ]);
    expect(links.every((link) => link.target === '_blank')).toBe(true);
    expect(links.every((link) => link.rel.includes('noopener'))).toBe(true);
  });
});
