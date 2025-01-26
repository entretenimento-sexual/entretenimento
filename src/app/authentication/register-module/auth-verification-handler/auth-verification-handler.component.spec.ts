import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthVerificationHandlerComponent } from './auth-verification-handler.component';

describe('AuthVerificationHandlerComponent', () => {
  let component: AuthVerificationHandlerComponent;
  let fixture: ComponentFixture<AuthVerificationHandlerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthVerificationHandlerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuthVerificationHandlerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
