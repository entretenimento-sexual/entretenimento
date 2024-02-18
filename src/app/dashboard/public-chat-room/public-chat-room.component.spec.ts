import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublicChatRoomComponent } from './public-chat-room.component';

describe('PublicChatRoomComponent', () => {
  let component: PublicChatRoomComponent;
  let fixture: ComponentFixture<PublicChatRoomComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicChatRoomComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(PublicChatRoomComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
