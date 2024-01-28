import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatMessagesListComponent } from './chat-messages-list.component';

describe('ChatMessagesListComponent', () => {
  let component: ChatMessagesListComponent;
  let fixture: ComponentFixture<ChatMessagesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatMessagesListComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ChatMessagesListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
