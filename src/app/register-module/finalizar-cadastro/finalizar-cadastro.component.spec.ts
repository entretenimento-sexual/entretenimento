//src\app\register-module\finalizar-cadastro\finalizar-cadastro.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { FinalizarCadastroComponent } from './finalizar-cadastro.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { FirestoreService } from '../../core/services/data-handling/firestore.service';
import { AuthService } from '../../core/services/autentication/auth.service';
import { StorageService } from '../../core/services/image-handling/storage.service';
import { IBGELocationService } from '../../core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

describe('FinalizarCadastroComponent', () => {
  let fixture: ComponentFixture<FinalizarCadastroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FinalizarCadastroComponent],
      imports: [RouterTestingModule, FormsModule, CommonModule],
      providers: [
        { provide: EmailVerificationService, useValue: { updateEmailVerificationStatus: () => of(void 0) } },
        { provide: IBGELocationService, useValue: { getEstados: () => of([]), getMunicipios: () => of([]) } },
        { provide: FirestoreUserQueryService, useValue: { getUser: () => of({ uid: 'u1' }), updateUserInStateAndCache: () => { } } },
        { provide: FirestoreService, useValue: { saveInitialUserData: () => Promise.resolve(void 0) } },
        { provide: AuthService, useValue: { user$: of({ uid: 'u1' }), setCurrentUser: () => { }, getLoggedUserUID$: () => of('u1') } },
        { provide: StorageService, useValue: { uploadProfileAvatar: () => of(null) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(FinalizarCadastroComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
