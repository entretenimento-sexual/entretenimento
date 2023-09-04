import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LegalFooterComponent } from './legal-footer.component';

describe('LegalFooterComponent', () => {
  let component: LegalFooterComponent;
  let fixture: ComponentFixture<LegalFooterComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LegalFooterComponent]
    });
    fixture = TestBed.createComponent(LegalFooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
