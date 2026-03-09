// src/test/jest-stubs/test-providers.ts
// ============================================================================
// Provedores e stubs reutilizáveis para testes unitários com Jest
//
// Objetivo:
// - Centralizar mocks comuns do AngularFire e dos serviços da aplicação
// - Remover dependência do AuthService legado
// - Expor estado reativo de autenticação/perfil para specs
// - Facilitar manutenção futura com helpers utilitários
// ============================================================================

import { Provider } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, take } from 'rxjs/operators';

import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { Functions } from '@angular/fire/functions';

// Tokens/serviços do app
import { FirestoreService } from '../../app/core/services/data-handling/legacy/firestore.service';
import { FirestoreUserQueryService } from '../../app/core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from '../../app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../app/core/services/autentication/auth/current-user-store.service';
import { ChatService } from '../../app/core/services/batepapo/chat-service/chat.service';
import { UserPreferencesService } from '../../app/core/services/preferences/user-preferences.service';
import { StorageService } from '../../app/core/services/image-handling/storage.service';
import { PhotoFirestoreService } from '../../app/core/services/image-handling/photo-firestore.service';
import { SubscriptionService } from '../../app/core/services/subscriptions/subscription.service';
import { RoomManagementService } from '../../app/core/services/batepapo/room-services/room-management.service';
import { FriendshipService } from '../../app/core/services/interactions/friendship/friendship.service';
import { GlobalErrorHandlerService } from '../../app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../app/core/services/error-handler/error-notification.service';

import type { IUserDados } from '../../app/core/interfaces/iuser-dados';

// ============================================================================
// Estado reativo compartilhado dos testes
// ============================================================================

export type TestAuthUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  emailVerified?: boolean;
} | null;

const authUserSubject = new BehaviorSubject<TestAuthUser>(null);
const authReadySubject = new BehaviorSubject<boolean>(true);
const currentUserSubject = new BehaviorSubject<IUserDados | null | undefined>(undefined);

// ============================================================================
// Helpers públicos para specs
// ============================================================================

/**
 * Reseta o estado global de autenticação/perfil entre specs.
 * - authUser = null
 * - ready = true
 * - currentUser = undefined (tri-state do store)
 */
export function resetTestingAuthState(): void {
  authUserSubject.next(null);
  authReadySubject.next(true);
  currentUserSubject.next(undefined);
}

/**
 * Define o "usuário do Auth" do teste.
 * - Atualiza o stream do AuthSessionService
 * - Não hidrata automaticamente o CurrentUserStoreService
 */
export function setTestingAuthUser(user: TestAuthUser): void {
  authUserSubject.next(user);
}

/**
 * Define o "usuário do app" no CurrentUserStoreService.
 * - Pode ser undefined (ainda hidratando)
 * - Pode ser null (deslogado)
 * - Pode ser IUserDados (perfil disponível)
 */
export function setTestingCurrentUser(user: IUserDados | null | undefined): void {
  currentUserSubject.next(user);
}

/**
 * Ajuda rápida para cenários em que Auth e Store devem ficar coerentes.
 */
export function seedTestingSession(user: Partial<IUserDados> & { uid: string }): void {
  const authUser: TestAuthUser = {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.nickname ?? null,
    emailVerified: !!user.emailVerified,
  };

  authUserSubject.next(authUser);
  currentUserSubject.next(user as IUserDados);
}

// ============================================================================
// Stubs dos tokens AngularFire
// ============================================================================

export const angularFireTokenStubs: Provider[] = [
  { provide: Firestore, useValue: {} as any },
  { provide: Auth, useValue: {} as any },
  { provide: Storage, useValue: {} as any },
  { provide: Functions, useValue: {} as any },
];

// ============================================================================
// Stubs canônicos de Auth (sem AuthService legado)
// ============================================================================

const authUid$: Observable<string | null> = authUserSubject.asObservable().pipe(
  map((user) => user?.uid ?? null),
  distinctUntilChanged()
);

const authIsAuthenticated$: Observable<boolean> = authUid$.pipe(
  map((uid) => !!uid),
  distinctUntilChanged()
);

export const authTestingProviders: Provider[] = [
  {
    provide: AuthSessionService,
    useValue: {
      authUser$: authUserSubject.asObservable(),
      uid$: authUid$,
      ready$: authReadySubject.asObservable(),
      isAuthenticated$: authIsAuthenticated$,

      whenReady: jest.fn(() => Promise.resolve()),
      signOut$: jest.fn(() => of(void 0)),

      get currentAuthUser() {
        return authUserSubject.value;
      },
    },
  },
  {
    provide: CurrentUserStoreService,
    useValue: {
      user$: currentUserSubject.asObservable(),

      set: jest.fn((user: IUserDados) => currentUserSubject.next(user)),
      patch: jest.fn((partial: Partial<IUserDados>) => {
        const current = currentUserSubject.value;
        if (!current || current === undefined || current === null) return;
        currentUserSubject.next({ ...current, ...partial } as IUserDados);
      }),
      clear: jest.fn(() => currentUserSubject.next(null)),
      markUnhydrated: jest.fn(() => currentUserSubject.next(undefined)),

      getSnapshot: jest.fn(() => currentUserSubject.value),

      getAuthReady$: jest.fn(() => authReadySubject.asObservable()),
      getLoggedUserUID$: jest.fn(() => authUid$),
      getLoggedUserUIDOnce$: jest.fn(() => authUid$.pipe(take(1))),
      getLoggedUserUIDSnapshot: jest.fn(() => authUserSubject.value?.uid ?? null),

      isHydratedOnce$: jest.fn(() =>
        currentUserSubject.asObservable().pipe(
          map((v) => v !== undefined),
          distinctUntilChanged(),
          take(1)
        )
      ),

      restoreFromCache: jest.fn(() => null),
      restoreFromCacheWhenReady$: jest.fn(() => of(null)),
    },
  },
];

// ============================================================================
// Stubs dos serviços da aplicação
// ============================================================================

export const appServiceStubs: Provider[] = [
  { provide: FirestoreService, useValue: {} },

  {
    provide: FirestoreUserQueryService,
    useValue: {
      getUser: jest.fn(() => of(null)),
      getUser$: jest.fn(() => of(null)),
      watchUserDocDeleted$: jest.fn(() => of(false)),
      getUsersPublicMap$: jest.fn(() => of({})),
    },
  },

  {
    provide: ChatService,
    useValue: {
      monitorChat: jest.fn(() => of([])),
      updateMessageStatus: jest.fn(() => Promise.resolve()),
      getOrCreateChatId: jest.fn(() => of('chat-test-1')),
      sendMessage: jest.fn(() => of(void 0)),
      updateChat: jest.fn(() => of(void 0)),
      deleteMessage: jest.fn(() => of(void 0)),
    },
  },

  { provide: UserPreferencesService, useValue: {} },

  {
    provide: FriendshipService,
    useValue: {
      searchUsers: jest.fn(() => of([])),
      blockUser: jest.fn(() => of(void 0)),
    },
  },

  {
    provide: StorageService,
    useValue: {
      replaceFile: jest.fn(() => of('https://example.com/file.jpg')),
      uploadProfileAvatar: jest.fn(() => of(null)),
    },
  },

  {
    provide: PhotoFirestoreService,
    useValue: {
      getPhotosByUser: jest.fn(() => of([])),
      savePhotoMetadata: jest.fn(async () => void 0),
      saveImageState: jest.fn(async () => void 0),
      updatePhotoMetadata: jest.fn(async () => void 0),
      deletePhoto: jest.fn(async () => void 0),
    },
  },

  {
    provide: SubscriptionService,
    useValue: {
      promptSubscription: jest.fn(),
    },
  },

  {
    provide: RoomManagementService,
    useValue: {
      createRoom: jest.fn(() => of({ roomId: 'room-1', roomName: 'Sala Teste', action: 'created' })),
    },
  },

  {
    provide: GlobalErrorHandlerService,
    useValue: {
      handleError: jest.fn(),
      formatErrorMessage: jest.fn((error: unknown) =>
        error instanceof Error ? error.message : 'Erro desconhecido'
      ),
    },
  },

  {
    provide: ErrorNotificationService,
    useValue: {
      showSuccess: jest.fn(),
      showError: jest.fn(),
      showWarning: jest.fn(),
      showInfo: jest.fn(),
      showNotification: jest.fn(),
    },
  },
];

// ============================================================================
// Provider agregado
// ============================================================================

export const commonTestingProviders = (): Provider[] => [
  ...angularFireTokenStubs,
  ...authTestingProviders,
  ...appServiceStubs,
];
