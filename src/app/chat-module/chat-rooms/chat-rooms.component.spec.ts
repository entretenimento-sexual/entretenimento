//src\app\chat-module\chat-rooms\chat-rooms.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ChatRoomsComponent } from './chat-rooms.component';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/services/autentication/auth.service';
import { SubscriptionService } from '../../core/services/subscriptions/subscription.service';
import { RoomService } from '../../core/services/batepapo/room-services/room.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

describe('ChatRoomsComponent', () => {
  let component: ChatRoomsComponent;
  let fixture: ComponentFixture<ChatRoomsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatRoomsComponent], // ✅
      providers: [
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1' }) } },
        { provide: SubscriptionService, useValue: { promptSubscription: jest.fn() } },
        { provide: RoomService, useValue: { getUserRooms: () => of([]), countUserRooms: () => Promise.resolve(0) } },
        { provide: RoomManagementService, useValue: { createRoom: () => of({ roomId: 'r1', roomName: 'Sala', action: 'created' }) } },
        { provide: ErrorNotificationService, useValue: { showError: jest.fn(), showWarning: jest.fn(), showInfo: jest.fn() } },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ChatRoomsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
