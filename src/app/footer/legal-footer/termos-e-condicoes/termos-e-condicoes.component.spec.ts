import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TermosECondicoesComponent } from './termos-e-condicoes.component';

describe('TermosECondicoesComponent', () => {
  let component: TermosECondicoesComponent;
  let fixture: ComponentFixture<TermosECondicoesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TermosECondicoesComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(TermosECondicoesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
