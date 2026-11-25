import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { BehaviorSubject, Subject, map } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ApplicationErrorService } from '../error-handler/application-error.service';
import {
  CommunityNotificationUnreadSummaryService,
  type CommunityNotificationGlobalSummary,
} from './community-notification-unread-summary.service';

describe('community unread summary session transition', () => {
  it('limpa imediatamente o contador antes de receber o resumo da nova conta', () => {
    const readyAuthUser$ = new BehaviorSubject<User | null>({ uid: 'a' } as User);
    const readyUid$ = readyAuthUser$.pipe(map(user => user?.uid ?? null));
    const a$ = new Subject<CommunityNotificationGlobalSummary>();
    const b$ = new Subject<CommunityNotificationGlobalSummary>();
    const summary = (unreadCount: number): CommunityNotificationGlobalSummary => ({
      unreadCount, priorityUnreadCount: 0, unreadCommunityCount: 1,
      priorityCommunityCount: 0, hasPriorityUnread: false,
      attentionWindow: [], updatedAt: 1, ready: true,
    });
    TestBed.configureTestingModule({ providers: [
      { provide: Firestore, useValue: {} },
      { provide: AuthSessionService, useValue: { readyUid$, readyAuthUser$ } },
      { provide: FirestoreContextService, useValue: {} },
      { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
    ] });
    const service = TestBed.inject(CommunityNotificationUnreadSummaryService);
    const watch = vi.spyOn(service as unknown as {
      watchUserGlobalSummary$: (uid: string) => Subject<CommunityNotificationGlobalSummary>;
    }, 'watchUserGlobalSummary$').mockImplementation(uid => uid === 'a' ? a$ : b$);
    const values: number[] = [];
    const sub = service.currentUserUnreadCount$.subscribe(value => values.push(value));
    try {
      a$.next(summary(7));
      expect(values.at(-1)).toBe(7);
      readyAuthUser$.next({ uid: 'b' } as User);
      expect(values.at(-1)).toBe(0);
      expect(a$.observed).toBe(false);
      a$.next(summary(99));
      expect(values.at(-1)).toBe(0);
      b$.next(summary(2));
      expect(values.at(-1)).toBe(2);
      expect(watch).toHaveBeenCalledTimes(2);
    } finally {
      sub.unsubscribe();
      TestBed.resetTestingModule();
    }
  });
});
