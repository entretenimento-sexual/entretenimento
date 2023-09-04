import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthenticationTestComponent } from './authentication-test.component';

describe('AuthenticationTestComponent', () => {
  let component: AuthenticationTestComponent;
  let fixture: ComponentFixture<AuthenticationTestComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AuthenticationTestComponent]
    });
    fixture = TestBed.createComponent(AuthenticationTestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
