import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';

import { TermosECondicoesComponent } from './termos-e-condicoes.component';

describe('TermosECondicoesComponent', () => {
  let component: TermosECondicoesComponent;
  let fixture: ComponentFixture<TermosECondicoesComponent>;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    router = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [TermosECondicoesComponent],
      providers: [
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

  it('deve criar e apresentar a versão atual dos termos', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Versão v2');
  });

  it('deve explicar cancelamento sem nova renovação e acesso até o fim da vigência', () => {
    const text = String(fixture.nativeElement.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(text).toContain('cancelar a renovação da assinatura a qualquer momento');
    expect(text).toContain('impede novas cobranças e renovações');
    expect(text).toContain('até o término do período corrente já pago');
    expect(text).toContain('direito de arrependimento');
  });

  it('deve voltar à página inicial ao fechar a rota pública', () => {
    component.closeDialog();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
});
