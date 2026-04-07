// src/test/jest-stubs/test-providers.ts
// ================================================================
// Provedores e stubs reutilizáveis para testes unitários com Jest
//
// Objetivo:
// - Centralizar mocks comuns do AngularFire e dos serviços da aplicação
// - Remover dependência do AuthService legado
// - Expor estado reativo de autenticação/perfil para specs
// - Facilitar manutenção futura com helpers utilitários
// ================================================================
import { vi } from 'vitest';
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

// ==========================================================
// Estado reativo compartilhado dos testes
// ============================================================

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

      whenReady: vi.fn(() => Promise.resolve()),
      signOut$: vi.fn(() => of(void 0)),

      get currentAuthUser() {
        return authUserSubject.value;
      },
    },
  },
  {
    provide: CurrentUserStoreService,
    useValue: {
      user$: currentUserSubject.asObservable(),

      set: vi.fn((user: IUserDados) => currentUserSubject.next(user)),
      patch: vi.fn((partial: Partial<IUserDados>) => {
        const current = currentUserSubject.value;
        if (!current || current === undefined || current === null) return;
        currentUserSubject.next({ ...current, ...partial } as IUserDados);
      }),
      clear: vi.fn(() => currentUserSubject.next(null)),
      markUnhydrated: vi.fn(() => currentUserSubject.next(undefined)),

      getSnapshot: vi.fn(() => currentUserSubject.value),

      getAuthReady$: vi.fn(() => authReadySubject.asObservable()),
      getLoggedUserUID$: vi.fn(() => authUid$),
      getLoggedUserUIDOnce$: vi.fn(() => authUid$.pipe(take(1))),
      getLoggedUserUIDSnapshot: vi.fn(() => authUserSubject.value?.uid ?? null),

      isHydratedOnce$: vi.fn(() =>
        currentUserSubject.asObservable().pipe(
          map((v) => v !== undefined),
          distinctUntilChanged(),
          take(1)
        )
      ),

      restoreFromCache: vi.fn(() => null),
      restoreFromCacheWhenReady$: vi.fn(() => of(null)),
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
      getUser: vi.fn(() => of(null)),
      getUser$: vi.fn(() => of(null)),
      watchUserDocDeleted$: vi.fn(() => of(false)),
      getUsersPublicMap$: vi.fn(() => of({})),
    },
  },

  {
    provide: ChatService,
    useValue: {
      monitorChat: vi.fn(() => of([])),
      updateMessageStatus: vi.fn(() => Promise.resolve()),
      getOrCreateChatId: vi.fn(() => of('chat-test-1')),
      sendMessage: vi.fn(() => of(void 0)),
      updateChat: vi.fn(() => of(void 0)),
      deleteMessage: vi.fn(() => of(void 0)),
    },
  },

  { provide: UserPreferencesService, useValue: {} },

  {
    provide: FriendshipService,
    useValue: {
      searchUsers: vi.fn(() => of([])),
      blockUser: vi.fn(() => of(void 0)),
    },
  },

  {
    provide: StorageService,
    useValue: {
      replaceFile: vi.fn(() => of('https://example.com/file.jpg')),
      uploadProfileAvatar: vi.fn(() => of(null)),
    },
  },

  {
    provide: PhotoFirestoreService,
    useValue: {
      getPhotosByUser: vi.fn(() => of([])),
      savePhotoMetadata: vi.fn(async () => void 0),
      saveImageState: vi.fn(async () => void 0),
      updatePhotoMetadata: vi.fn(async () => void 0),
      deletePhoto: vi.fn(async () => void 0),
    },
  },

  {
    provide: SubscriptionService,
    useValue: {
      promptSubscription: vi.fn(),
    },
  },

  {
    provide: RoomManagementService,
    useValue: {
      createRoom: vi.fn(() => of({ roomId: 'room-1', roomName: 'Sala Teste', action: 'created' })),
    },
  },

  {
    provide: GlobalErrorHandlerService,
    useValue: {
      handleError: vi.fn(),
      formatErrorMessage: vi.fn((error: unknown) =>
        error instanceof Error ? error.message : 'Erro desconhecido'
      ),
    },
  },

  {
    provide: ErrorNotificationService,
    useValue: {
      showSuccess: vi.fn(),
      showError: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
      showNotification: vi.fn(),
    },
  },
];

// ===============================================================
// Provider agregado
// ===============================================================
export const commonTestingProviders = (): Provider[] => [
  ...angularFireTokenStubs,
  ...authTestingProviders,
  ...appServiceStubs,
];
