//src\app\shared\components-globais\user-card\chat-user-card\chat-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatUserCardComponent } from './chat-user-card.component';

describe('ChatUserCardComponent', () => {
  let component: ChatUserCardComponent;
  let fixture: ComponentFixture<ChatUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatUserCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ChatUserCardComponent);
    // 👇 resolvendo NG0950
    fixture.componentRef.setInput('user', { uid: 'u1', nickname: 'Tester' } as any);
    fixture.componentRef.setInput('lastMessage', 'Olá!');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });;

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
