//src\app\layout\profile-list\profile-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import { ProfileListComponent } from './profile-list.component';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { FirestoreQueryService } from '../../core/services/data-handling/firestore-query.service';
import { NO_ERRORS_SCHEMA } from '@angular/core';

class MockCurrentUserStoreService {
  // começa sem usuário (null). Use .next({...}) no teste para simular login.
  user$ = new BehaviorSubject<any | null>(null);
}

class MockFirestoreQueryService {
  getSuggestedProfiles = jest.fn(() =>
    of([
      { uid: 'p1', nickname: 'Alice' },
      { uid: 'p2', nickname: 'Bob' },
    ])
  );
}

describe('ProfileListComponent', () => {
  let component: ProfileListComponent;
  let fixture: ComponentFixture<ProfileListComponent>;
  let userStore: MockCurrentUserStoreService;
  let fsQuery: MockFirestoreQueryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ProfileListComponent],
      providers: [
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: FirestoreQueryService, useClass: MockFirestoreQueryService },
      ],
      // Evita erros com templates parciais/child components não declarados
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileListComponent);
    component = fixture.componentInstance;

    userStore = TestBed.inject(CurrentUserStoreService) as any;
    fsQuery = TestBed.inject(FirestoreQueryService) as any;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('não deve buscar perfis quando não há usuário logado', () => {
    fixture.detectChanges();
    expect(fsQuery.getSuggestedProfiles).not.toHaveBeenCalled();
    expect(component.profiles).toEqual([]);
  });

  it('deve buscar perfis quando usuário logar', () => {
    fixture.detectChanges();
    userStore.user$.next({ uid: 'u1', nickname: 'tester' });

    // dispara detecção de mudanças; em cenários reais a stream já terá emitido
    fixture.detectChanges();

    expect(fsQuery.getSuggestedProfiles).toHaveBeenCalledTimes(1);
    expect(component.profiles.length).toBe(2);
    expect(component.profiles[0].nickname).toBe('Alice');
  });

  it('deve usar trackByUid corretamente', () => {
    const obj: any = { uid: 'abc' };
    expect(component.trackByUid(0, obj)).toBe('abc');
  });
});
