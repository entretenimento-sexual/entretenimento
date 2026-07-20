// src/app/chat-module/modals/create-room-modal/create-room-modal.component.spec.ts
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { VenueService } from 'src/app/core/services/venues/venue.service';
import { FormValidationFocusDirective } from 'src/app/shared/form-validation-focus/form-validation-focus.directive';
import { CreateRoomModalComponent } from './create-room-modal.component';

describe('CreateRoomModalComponent', () => {
  let component: CreateRoomModalComponent;
  let fixture: ComponentFixture<CreateRoomModalComponent>;
  let closeMock: ReturnType<typeof vi.fn>;
  let dialogOpenMock: ReturnType<typeof vi.fn>;
  let dialogResult: boolean;

  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers();
    closeMock = vi.fn();
    dialogResult = false;
    dialogOpenMock = vi.fn(() => ({
      afterClosed: () => of(dialogResult),
    }));

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
        { provide: Auth, useValue: { currentUser: { uid: 'room-owner' } } },
        { provide: MatDialogRef, useValue: { close: closeMock } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialog, useValue: { open: dialogOpenMock } },
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

  afterEach(() => {
    fixture.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('deve validar o mesmo limite de nome usado pelo backend', () => {
    component.roomForm.controls.roomName.setValue('ab');
    expect(
      component.roomForm.controls.roomName.hasError('minlength')
    ).toBe(true);

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

  it('restaura o rascunho temporário em uma nova instância', () => {
    component.roomForm.patchValue({
      roomName: 'Sala em rascunho',
      description: 'Descrição preservada',
    });
    vi.advanceTimersByTime(500);
    fixture.destroy();

    fixture = TestBed.createComponent(CreateRoomModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.roomForm.controls.roomName.value).toBe(
      'Sala em rascunho'
    );
    expect(component.roomForm.dirty).toBe(true);
  });

  it('só descarta o rascunho após confirmação', () => {
    component.roomForm.controls.roomName.setValue('Sala alterada');
    vi.advanceTimersByTime(500);

    component.cancel();
    expect(closeMock).not.toHaveBeenCalled();

    dialogResult = true;
    component.cancel();

    expect(dialogOpenMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledWith(null);
  });
});
