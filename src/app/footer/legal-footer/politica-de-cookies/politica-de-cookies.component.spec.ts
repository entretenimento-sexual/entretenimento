import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PoliticaDeCookiesComponent } from './politica-de-cookies.component';

describe('PoliticaDeCookiesComponent', () => {
  let component: PoliticaDeCookiesComponent;
  let fixture: ComponentFixture<PoliticaDeCookiesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoliticaDeCookiesComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(PoliticaDeCookiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
