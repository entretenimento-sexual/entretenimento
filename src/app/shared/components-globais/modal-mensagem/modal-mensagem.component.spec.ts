//src\app\shared\components-globais\modal-mensagem\modal-mensagem.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ModalMensagemComponent } from './modal-mensagem.component';
import { ChatService } from '../../../core/services/batepapo/chat-service/chat.service';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../../core/services/autentication/auth.service';

describe('ModalMensagemComponent', () => {
  let component: ModalMensagemComponent;
  let fixture: ComponentFixture<ModalMensagemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ModalMensagemComponent], // ✅
      providers: [
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { profile: { uid: 'u2' } } },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1' }) } },
        {
          provide: ChatService, useValue: {
            getOrCreateChatId: () => of('chat-1'),
            sendMessage: () => of(void 0),
            updateChat: () => of(void 0),
          }
        },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ModalMensagemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
