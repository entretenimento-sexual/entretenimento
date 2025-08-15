// src/app/chat-module/modals/invite-user-modal/invite-user-modal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InviteUserModalComponent } from './invite-user-modal.component';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

// stubs necessários pelo componente
const authStub = {
  getLoggedUserUID$: jest.fn(() => of('uid-123')),
  currentUser: { uid: 'uid-123', role: 'admin' },
};
const ibgeStub = {
  getEstados: jest.fn(() => of([{ sigla: 'SP' }, { sigla: 'RJ' }])),
  getMunicipios: jest.fn(() => of([{ nome: 'São Paulo' }, { nome: 'Rio de Janeiro' }])),
};
const regionFilterStub = {
  getUserRegion: jest.fn(() => of({ uf: 'SP', city: 'São Paulo' })),
};
const inviteSearchStub = {
  searchEligibleUsers: jest.fn(() => of([])),
};
const inviteServiceStub = {
  createInvite: jest.fn(() => of(void 0)),
};

describe('InviteUserModalComponent', () => {
  let fixture: ComponentFixture<InviteUserModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InviteUserModalComponent, MatDialogModule, NoopAnimationsModule], // standalone
      providers: [
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { roomId: 'r1', roomName: 'Sala' } },
        { provide: 'AuthService', useValue: authStub },              // ou o próprio token da classe, se acessível
        { provide: 'IBGELocationService', useValue: ibgeStub },
        { provide: 'RegionFilterService', useValue: regionFilterStub },
        { provide: 'InviteSearchService', useValue: inviteSearchStub },
        { provide: 'InviteService', useValue: inviteServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteUserModalComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
