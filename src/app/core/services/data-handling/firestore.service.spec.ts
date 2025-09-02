// src/app/core/services/data-handling/firestore.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { FirestoreService } from './firestore.service';

import { Firestore, collection, doc, query, collectionData, setDoc, updateDoc,
         deleteDoc, increment, getDocs, where, getDoc, arrayUnion,
         } from '@angular/fire/firestore';

import { getAuth } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

// === IMPORTA AS CLASSES COMO TOKENS (para DI) ===
import { CacheService } from '../../services/general/cache/cache.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { FirestoreErrorHandlerService } from '../../services/error-handler/firestore-error-handler.service';

// ---- helpers para tipar os mocks
const mCollection = collection as unknown as jest.Mock;
const mDoc = doc as unknown as jest.Mock;
const mQuery = query as unknown as jest.Mock;
const mCollectionData = collectionData as unknown as jest.Mock;
const mSetDoc = setDoc as unknown as jest.Mock;
const mUpdateDoc = updateDoc as unknown as jest.Mock;
const mDeleteDoc = deleteDoc as unknown as jest.Mock;
const mIncrement = increment as unknown as jest.Mock;
const mGetDocs = getDocs as unknown as jest.Mock;
const mWhere = where as unknown as jest.Mock;
const mGetDoc = getDoc as unknown as jest.Mock;
const mArrayUnion = arrayUnion as unknown as jest.Mock;
const mGetAuth = getAuth as unknown as jest.Mock;

// ---- mocks dos serviços injetados
class CacheServiceMock {
  get = jest.fn().mockReturnValue(of(null));
  set = jest.fn();
}

class GlobalErrorHandlerServiceMock {
  handleError = jest.fn();
}

class FirestoreErrorHandlerServiceMock {
  handleFirestoreError = jest.fn((e: any) => throwError(() => e));
}

describe('FirestoreService', () => {
  let service: FirestoreService;

  beforeAll(() => {
    (Timestamp as any).now = jest.fn(() => ({ toDate: () => new Date() }));
    mIncrement.mockImplementation((n: number) => ({ __inc__: n }));
    mWhere.mockImplementation(() => ({ __where__: true }));
    mCollection.mockImplementation(() => ({ __collection__: true }));
    mDoc.mockImplementation(() => ({ __doc__: true }));
    mQuery.mockImplementation(() => ({ __query__: true }));
    mGetAuth.mockReturnValue({ currentUser: { uid: 'u-123' } });
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FirestoreService,
        { provide: Firestore, useValue: {} },
        // >>> usa classes como tokens, mocks como implementações
        { provide: GlobalErrorHandlerService, useClass: GlobalErrorHandlerServiceMock },
        { provide: FirestoreErrorHandlerService, useClass: FirestoreErrorHandlerServiceMock },
        { provide: CacheService, useClass: CacheServiceMock },
      ],
    });

    service = TestBed.inject(FirestoreService);
    jest.clearAllMocks();
  });

  it('deve expor a instância do Firestore', () => {
    const fsInstance = service.getFirestoreInstance();
    expect(fsInstance).toBeTruthy();
  });

  describe('getDocument', () => {
    it('deve retornar os dados quando o documento existe', (done) => {
      mGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ foo: 'bar' }),
      });

      service.getDocument<{ foo: string }>('users', 'id1').subscribe((res) => {
        expect(res).toEqual({ foo: 'bar' });
        expect(mDoc).toHaveBeenCalled();
        expect(mGetDoc).toHaveBeenCalled();
        done();
      });
    });

    it('deve retornar null quando o documento não existe', (done) => {
      mGetDoc.mockResolvedValue({
        exists: () => false,
        data: () => ({}),
      });

      service.getDocument('users', 'id1').subscribe((res) => {
        expect(res).toBeNull();
        done();
      });
    });
  });

  describe('getDocuments', () => {
    it('deve usar o cache quando disponível', (done) => {
      const cache = TestBed.inject(CacheService) as unknown as CacheServiceMock;
      cache.get.mockReturnValueOnce(of([{ id: '1', a: 1 }]));

      service.getDocuments<any>('users', []).subscribe((res) => {
        expect(res).toEqual([{ id: '1', a: 1 }]);
        expect(mCollectionData).not.toHaveBeenCalled();
        done();
      });
    });

    it('deve consultar e preencher o cache quando não há cache', (done) => {
      const cache = TestBed.inject(CacheService) as unknown as CacheServiceMock;
      cache.get.mockReturnValueOnce(of(null));
      mCollectionData.mockReturnValueOnce(of([{ id: 'x', a: 2 }]));

      service.getDocuments<any>('users', [], true).subscribe((res) => {
        expect(mCollection).toHaveBeenCalled();
        expect(mQuery).toHaveBeenCalled();
        expect(mCollectionData).toHaveBeenCalled();
        expect(cache.set).toHaveBeenCalledWith(
          (expect as any).any(String),
          [{ id: 'x', a: 2 }],
          (expect as any).any(Number)
        );
        expect(res).toEqual([{ id: 'x', a: 2 }]);
        done();
      });
    });
  });

  describe('CRUD simples', () => {
    it('addDocument deve chamar setDoc', (done) => {
      mSetDoc.mockResolvedValueOnce(undefined);
      service.addDocument('users', { a: 1 } as any).subscribe({
        next: () => {
          expect(mCollection).toHaveBeenCalled();
          expect(mDoc).toHaveBeenCalled();
          expect(mSetDoc).toHaveBeenCalled();
          done();
        },
      });
    });

    it('updateDocument deve chamar updateDoc', (done) => {
      mUpdateDoc.mockResolvedValueOnce(undefined);
      service.updateDocument('users', 'id1', { a: 2 }).subscribe({
        next: () => {
          expect(mDoc).toHaveBeenCalled();
          expect(mUpdateDoc).toHaveBeenCalledWith((expect as any).anything(), { a: 2 });
          done();
        },
      });
    });

    it('deleteDocument deve chamar deleteDoc', (done) => {
      mDeleteDoc.mockResolvedValueOnce(undefined);
      service.deleteDocument('users', 'id1').subscribe({
        next: () => {
          expect(mDoc).toHaveBeenCalled();
          expect(mDeleteDoc).toHaveBeenCalled();
          done();
        },
      });
    });
  });

  it('incrementField deve chamar updateDoc com increment', (done) => {
    mUpdateDoc.mockResolvedValueOnce(undefined);

    service.incrementField('users', 'id1', 'count', 5).subscribe({
      next: () => {
        expect(mUpdateDoc).toHaveBeenCalledWith(
          (expect as any).anything(),
          (expect as any).objectContaining({ count: { __inc__: 5 } })
        );
        done();
      },
    });
  });

  describe('checkIfEmailExists', () => {
    it('retorna true quando há documentos', (done) => {
      mGetDocs.mockResolvedValueOnce({ size: 1 });
      service.checkIfEmailExists('a@b.com').subscribe((exists) => {
        expect(mCollection).toHaveBeenCalledWith((expect as any).anything(), 'users');
        expect(mWhere).toHaveBeenCalled();
        expect(mGetDocs).toHaveBeenCalled();
        expect(exists).toBe(true);
        done();
      });
    });

    it('retorna false quando não há documentos', (done) => {
      mGetDocs.mockResolvedValueOnce({ size: 0 });
      service.checkIfEmailExists('a@b.com').subscribe((exists) => {
        expect(exists).toBe(false);
        done();
      });
    });
  });

  describe('saveInitialUserData', () => {
    it('monta municipioEstado e persiste com arrayUnion', (done) => {
      mSetDoc.mockResolvedValueOnce(undefined);
      mArrayUnion.mockImplementation((...args: any[]) => ({ __arrayUnion__: args }));

      service.saveInitialUserData('uid-1', {
        uid: 'uid-1',
        emailVerified: true,
        email: 'a@b.com',
        nickname: 'Nick',
        isSubscriber: false,
        firstLogin: new Date(),
        gender: 'x',
        orientation: 'y',
        estado: 'SP',
        municipio: 'São Paulo',
        acceptedTerms: { accepted: true, date: new Date() },
        profileCompleted: true,
      } as any).subscribe({
        next: () => {
          expect(mDoc).toHaveBeenCalledWith((expect as any).anything(), 'users', 'uid-1');
          expect(mSetDoc).toHaveBeenCalled();
          const payload = mSetDoc.mock.calls[0][1];
          expect(payload.municipioEstado).toBe('São Paulo - SP');
          expect(payload.nicknameHistory).toBeDefined();
          expect(mArrayUnion).toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe('savePublicIndexNickname', () => {
    it('usa getAuth().currentUser e grava no índice público', (done) => {
      mSetDoc.mockResolvedValueOnce(undefined);

      service.savePublicIndexNickname('FoO').subscribe({
        next: () => {
          const wroteNew = mDoc.mock.calls.some((args) =>
            args[1] === 'public_index' && args[2] === 'nickname:foo'
          );
          expect(wroteNew).toBe(true);
          expect(mSetDoc).toHaveBeenCalled();

          const payload = mSetDoc.mock.calls[0][1];
          expect(payload.value).toBe('foo');
          expect(payload.uid).toBe('u-123');
          expect(payload.type).toBe('nickname');
          done();
        },
      });
    });
  });

  describe('updatePublicNickname', () => {
    it('falha se não autenticado', (done) => {
      mGetAuth.mockReturnValueOnce({ currentUser: null });
      service.updatePublicNickname('a', 'b', true).subscribe({
        next: () => fail('era esperado erro'),
        error: (e) => {
          expect(String(e)).toContain('Usuário não autenticado');
          done();
        },
      });
    });

    it('falha se não for assinante', (done) => {
      service.updatePublicNickname('a', 'b', false).subscribe({
        next: () => fail('era esperado erro'),
        error: (e) => {
          expect(String(e)).toContain('restrita a assinantes');
          done();
        },
      });
    });

    it('falha se novo apelido já estiver em uso', (done) => {
      mGetAuth.mockReturnValueOnce({ currentUser: { uid: 'u-123' } });
      mGetDoc.mockResolvedValueOnce({ exists: () => true });

      service.updatePublicNickname('old', 'new', true).subscribe({
        next: () => fail('era esperado erro'),
        error: (e) => {
          expect(String(e)).toContain('já está em uso');
          done();
        },
      });
    });

    it('sucesso: deleta antigo e cria o novo', (done) => {
      mGetAuth.mockReturnValueOnce({ currentUser: { uid: 'u-123' } });
      mGetDoc.mockResolvedValueOnce({ exists: () => false });
      mDeleteDoc.mockResolvedValueOnce(undefined);
      mSetDoc.mockResolvedValueOnce(undefined);

      service.updatePublicNickname('oldNick', 'newNick', true).subscribe({
        next: () => {
          expect(mDeleteDoc).toHaveBeenCalled();
          expect(mSetDoc).toHaveBeenCalled();
          const call = mDoc.mock.calls.find((args) => args[1] === 'nickname:newnick');
          expect(call).toBeTruthy();
          done();
        },
      });
    });
  });

  it('propaga erro pelo handleFirestoreError quando operações falham', (done) => {
    const geh = TestBed.inject(GlobalErrorHandlerService) as unknown as GlobalErrorHandlerServiceMock;
    mUpdateDoc.mockRejectedValueOnce(new Error('boom'));

    service.updateDocument('users', 'id1', { a: 1 }).subscribe({
      next: () => fail('era esperado erro'),
      error: (e) => {
        expect(geh.handleError).toHaveBeenCalled();
        expect(String(e)).toContain('boom');
        done();
      },
    });
  });
});
