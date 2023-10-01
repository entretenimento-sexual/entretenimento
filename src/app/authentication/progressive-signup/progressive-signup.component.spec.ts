import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressiveSignupComponent } from './progressive-signup.component';

describe('ProgressiveSignupComponent', () => {
  let component: ProgressiveSignupComponent;
  let fixture: ComponentFixture<ProgressiveSignupComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ProgressiveSignupComponent]
    });
    fixture = TestBed.createComponent(ProgressiveSignupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
