//src\app\core\services\autentication\register\register.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { RegisterService } from './register.service';
import { of, throwError } from 'rxjs';
import { FirestoreService } from '../../data-handling/firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';

describe('RegisterService', () => {
  let service: RegisterService;
  let firestoreService: jest.Mocked<FirestoreService>;
  let emailVerificationService: jest.Mocked<EmailVerificationService>;
  let errorHandler: jest.Mocked<GlobalErrorHandlerService>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RegisterService,
        {
          provide: FirestoreService,
          useValue: {
            saveInitialUserData: jest.fn().mockReturnValue(of(void 0)),
            savePublicIndexNickname: jest.fn().mockReturnValue(of(void 0)),
            checkIfEmailExists: jest.fn().mockResolvedValue(false),
            getFirestoreInstance: jest.fn(),
          },
        },
        {
          provide: EmailVerificationService,
          useValue: {
            sendEmailVerification: jest.fn().mockReturnValue(of(void 0)),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: jest.fn(),
          },
        },
        {
          provide: FirestoreValidationService,
          useValue: {
            checkIfNicknameExists: jest.fn().mockReturnValue(of(false)),
          },
        },
        {
          provide: FirestoreUserQueryService,
          useValue: {},
        },
      ],
    });

    service = TestBed.inject(RegisterService);
    firestoreService = TestBed.inject(FirestoreService) as jest.Mocked<FirestoreService>;
    emailVerificationService = TestBed.inject(EmailVerificationService) as jest.Mocked<EmailVerificationService>;
    errorHandler = TestBed.inject(GlobalErrorHandlerService) as jest.Mocked<GlobalErrorHandlerService>;
  });

  it('deve falhar se o apelido já estiver em uso', (done) => {
    const mockUserData = {
      nickname: 'apelidoEmUso',
      email: 'teste@exemplo.com',
      acceptedTerms: true,
    } as any;

    // Apelido já existe
    const firestoreValidation = TestBed.inject(FirestoreValidationService) as jest.Mocked<FirestoreValidationService>;
    firestoreValidation.checkIfNicknameExists.mockReturnValue(of(true));

    service.registerUser(mockUserData, 'senha123').subscribe({
      next: () => {
        fail('Deveria ter falhado por apelido já existente');
        done();
      },
      error: (err) => {
        expect(err.message).toContain('Apelido já está em uso');
        done();
      },
    });
  });

  it('deve executar rollback se falhar ao salvar no Firestore', (done) => {
    const mockUserData = {
      nickname: 'usuarioRollback',
      email: 'rollback@exemplo.com',
      acceptedTerms: true,
    } as any;

    const firestoreService = TestBed.inject(FirestoreService) as jest.Mocked<FirestoreService>;
    firestoreService.saveInitialUserData.mockReturnValue(throwError(() => new Error('Falha ao salvar')));

    jest.spyOn(require('firebase/auth'), 'createUserWithEmailAndPassword').mockResolvedValue({
      user: {
        uid: 'rollback123',
        email: mockUserData.email,
        delete: jest.fn(),
      },
    } as any);

    jest.spyOn(require('firebase/auth'), 'getAuth').mockReturnValue({
      currentUser: {
        uid: 'rollback123',
        delete: jest.fn().mockResolvedValue(undefined),
      },
    } as any);

    jest.spyOn(require('firebase/auth'), 'updateProfile').mockResolvedValue(undefined);

    service.registerUser(mockUserData, 'senha123').subscribe({
      next: () => {
        fail('Deveria ter falhado no Firestore');
        done();
      },
      error: (err) => {
        expect(err.message).toContain('Falha ao salvar');
        done();
      },
    });
  });

  it('deve completar o registro com sucesso', (done) => {
    const mockUserData = {
      nickname: 'usuarioTeste',
      email: 'teste@exemplo.com',
      acceptedTerms: true,
    } as any;

    // Simular createUserWithEmailAndPassword
    jest.spyOn(require('firebase/auth'), 'createUserWithEmailAndPassword').mockResolvedValue({
      user: {
        uid: 'abc123',
        email: mockUserData.email,
        delete: jest.fn(),
      },
    } as any);

    jest.spyOn(require('firebase/auth'), 'getAuth').mockReturnValue({ currentUser: { uid: 'abc123' } } as any);
    jest.spyOn(require('firebase/auth'), 'updateProfile').mockResolvedValue(void 0);

    service.registerUser(mockUserData, 'senhaSegura123').subscribe({
      next: (cred) => {
        expect(cred.user.uid).toBe('abc123');
        done();
      },
      error: (err) => {
        fail('Não deveria ter falhado: ' + err.message);
        done();
      },
    });
  });
});
