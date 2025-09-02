//src\app\chat-module\modals\room-create-confirm-modal\room-creation-confirmation-modal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';


import { RoomCreationConfirmationModalComponent } from './room-creation-confirmation-modal.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

describe('RoomCreationConfirmationComponent', () => {
  let component: RoomCreationConfirmationModalComponent;
  let fixture: ComponentFixture<RoomCreationConfirmationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RoomCreationConfirmationModalComponent],
      imports: [CommonModule, RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        {
          provide: MAT_DIALOG_DATA, useValue: {
            action: 'create',
            exceededLimit: false,
            roomCount: 0,
            room: { roomName: 'Sala Teste' } // adicione outros campos se o template usar
          }
        },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomCreationConfirmationModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
