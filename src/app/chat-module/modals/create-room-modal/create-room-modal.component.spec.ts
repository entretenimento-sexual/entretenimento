// src/app/chat-module/modals/create-room-modal/create-room-modal.component.spec.ts
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { of } from 'rxjs';

import { VenueService } from 'src/app/core/services/venues/venue.service';
import { CreateRoomModalComponent } from './create-room-modal.component';

describe('CreateRoomModalComponent', () => {
  let component: CreateRoomModalComponent;
  let fixture: ComponentFixture<CreateRoomModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CreateRoomModalComponent],
      imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatDialogModule,
      ],
      providers: [
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        {
          provide: VenueService,
          useValue: {
            watchVenuesForRegion$: vi.fn(() => of([])),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateRoomModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('deve validar o mesmo limite de nome usado pelo backend', () => {
    component.roomForm.controls.roomName.setValue('ab');
    expect(component.roomForm.controls.roomName.hasError('minlength')).toBe(true);

    component.roomForm.controls.roomName.setValue('Sala válida');
    expect(component.roomForm.controls.roomName.valid).toBe(true);
  });
});
