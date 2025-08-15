//src\app\chat-module\rooms\room-interaction\room-interaction.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';

import { RoomInteractionComponent } from './room-interaction.component';
import { RoomParticipantsService } from '../../../core/services/batepapo/room-services/room-participants.service';
import { RoomMessagesService } from '../../../core/services/batepapo/room-services/room-messages.service';
import { RoomService } from '../../../core/services/batepapo/room-services/room.service';
import { FirestoreUserQueryService } from '../../../core/services/data-handling/firestore-user-query.service';
import { FirestoreQueryService } from '../../../core/services/data-handling/firestore-query.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { AuthService } from '../../../core/services/autentication/auth.service';

describe('RoomInteractionComponent', () => {
  let component: RoomInteractionComponent;
  let fixture: ComponentFixture<RoomInteractionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RoomInteractionComponent], // não-standalone
      imports: [CommonModule, RouterTestingModule],
      providers: [
        {
          provide: RoomParticipantsService, useValue: {
            getParticipants: jest.fn(() => of([])),
            getRoomCreator: jest.fn(() => of(null)),
          }
        },
        {
          provide: RoomMessagesService, useValue: {
            getRoomMessages: jest.fn(() => of([])),
            sendMessageToRoom: jest.fn(() => of(void 0)),
          }
        },
        {
          provide: RoomService, useValue: {
            getRoomById: jest.fn(() => of({ roomName: 'Sala X' })),
          }
        },
        { provide: FirestoreUserQueryService, useValue: { getUser: jest.fn(() => of(null)) } },
        { provide: FirestoreQueryService, useValue: { getUserFromState: jest.fn(() => of(null)) } },
        { provide: ErrorNotificationService, useValue: { showError: jest.fn(), showWarning: jest.fn() } },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1', nickname: 'Tester' }) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomInteractionComponent);
    // 👇 resolve NG0950
    fixture.componentRef.setInput('roomId', 'room-1');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
