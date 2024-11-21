import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RoomInteractionComponent } from './room-interaction.component';

describe('RoomInteractionComponent', () => {
  let component: RoomInteractionComponent;
  let fixture: ComponentFixture<RoomInteractionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomInteractionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RoomInteractionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
