import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EmailInputModalComponent } from './email-input-modal.component';

describe('EmailInputModalComponent', () => {
  let component: EmailInputModalComponent;
  let fixture: ComponentFixture<EmailInputModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailInputModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EmailInputModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
