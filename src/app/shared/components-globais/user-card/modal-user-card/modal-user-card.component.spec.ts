import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalUserCardComponent } from './modal-user-card.component';

describe('ModalUserCardComponent', () => {
  let component: ModalUserCardComponent;
  let fixture: ComponentFixture<ModalUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalUserCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ModalUserCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
