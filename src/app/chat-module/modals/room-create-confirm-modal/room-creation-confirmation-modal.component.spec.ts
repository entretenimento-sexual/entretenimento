import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RoomCreationConfirmationModalComponent } from './room-creation-confirmation-modal.component';

describe('RoomCreationConfirmationComponent', () => {
  let component: RoomCreationConfirmationModalComponent;
  let fixture: ComponentFixture<RoomCreationConfirmationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomCreationConfirmationModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RoomCreationConfirmationModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
