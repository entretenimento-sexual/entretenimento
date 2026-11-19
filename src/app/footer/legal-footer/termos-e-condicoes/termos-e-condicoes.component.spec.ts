import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { TERMS_ACCEPTANCE_VERSION } from '../../../core/services/compliance/platform-legal.constants';
import { TermosECondicoesComponent } from './termos-e-condicoes.component';

describe('TermosECondicoesComponent', () => {
  let component: TermosECondicoesComponent;
  let fixture: ComponentFixture<TermosECondicoesComponent>;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let queryParamMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    router = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };
    queryParamMap = new BehaviorSubject(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [TermosECondicoesComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap } },
        {
          provide: Router,
          useValue: router,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TermosECondicoesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar e apresentar a versão material atual dos termos', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain(
      `Versão de aceite ${TERMS_ACCEPTANCE_VERSION}`
    );
  });

  it('deve explicar cancelamento, fim de cobrança e vigência já paga', () => {
    const text = String(fixture.nativeElement.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(text).toContain('O cancelamento impede cobranças futuras');
    expect(text).toContain('até o fim do período já pago');
    expect(text).toContain('direito de arrependimento');
    expect(text).toContain('renovação automática');
  });

  it('deve voltar à página inicial ao fechar a rota pública', () => {
    component.closeDialog();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('retoma a etapa pendente quando aberto a partir do aceite', () => {
    queryParamMap.next(convertToParamMap({ origem: 'cadastro' }));
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.textContent?.trim()).toBe('Voltar ao cadastro');
    button.click();
    expect(router.navigateByUrl).toHaveBeenCalledExactlyOnceWith('/register/welcome');
  });
});
