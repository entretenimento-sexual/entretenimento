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
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VenueService } from 'src/app/core/services/venues/venue.service';
import { FormValidationFocusDirective } from 'src/app/shared/form-validation-focus/form-validation-focus.directive';
import { CreateRoomModalComponent } from './create-room-modal.component';

describe('CreateRoomModalComponent', () => {
  let component: CreateRoomModalComponent;
  let fixture: ComponentFixture<CreateRoomModalComponent>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    closeMock = vi.fn();

    await TestBed.configureTestingModule({
      declarations: [CreateRoomModalComponent],
      imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        MatDialogModule,
        FormValidationFocusDirective,
      ],
      providers: [
        { provide: MatDialogRef, useValue: { close: closeMock } },
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

  it('mantém o submit acionável para revelar erros do formulário', () => {
    const submit = fixture.debugElement.query(
      By.css('button[type="submit"]')
    ).nativeElement as HTMLButtonElement;

    expect(component.roomForm.invalid).toBe(true);
    expect(submit.disabled).toBe(false);
  });

  it('foca o nome quando a Sala é submetida vazia', () => {
    const input = fixture.debugElement.query(By.css('#roomName'))
      .nativeElement as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');

    component.onSubmit();
    fixture.detectChanges();
    vi.runAllTimers();

    expect(component.roomForm.controls.roomName.touched).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('fecha com payload sanitizado quando os dados são válidos', () => {
    component.roomForm.patchValue({
      roomName: '  Sala Centro  ',
      description: '  Encontro reservado.  ',
    });

    component.onSubmit();

    expect(closeMock).toHaveBeenCalledWith({
      success: true,
      action: 'created',
      roomId: null,
      roomDetails: {
        roomName: 'Sala Centro',
        description: 'Encontro reservado.',
        placeIntent: null,
      },
    });
  });
});
