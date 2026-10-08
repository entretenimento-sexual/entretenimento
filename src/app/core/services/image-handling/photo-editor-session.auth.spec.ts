import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { PhotoEditorSessionService } from './photo-editor-session.service';

function harness() {
  const uid$ = new BehaviorSubject<string | null>('owner-a');
  const auth = { uid$: uid$.asObservable(), isTerminatingSnapshot: false };
  TestBed.configureTestingModule({
    providers: [
      PhotoEditorSessionService,
      { provide: AuthSessionService, useValue: auth },
    ],
  });
  return { session: TestBed.inject(PhotoEditorSessionService), uid$, auth };
}

describe('PhotoEditorSessionService / isolamento de rascunhos', () => {
  it('descarta File em logout e rejeita retorno atrasado de A sob B', async () => {
    const { session, uid$ } = harness();
    const file = new File(['photo-a'], 'photo-a.jpg', { type: 'image/jpeg' });
    session.setCreateDraft(file, 'owner-a');
    expect(session.peekDraft()).toMatchObject({ ownerUid: 'owner-a', file });

    uid$.next(null);
    expect(session.peekDraft()).toBeNull();
    expect(await firstValueFrom(session.draft$)).toBeNull();

    uid$.next('owner-b');
    expect(() => session.setCreateDraft(file, 'owner-a')).toThrow('Sua sessão mudou');
    expect(session.peekDraft()).toBeNull();
    const fileB = new File(['photo-b'], 'photo-b.jpg', { type: 'image/jpeg' });
    session.setCreateDraft(fileB, 'owner-b');
    expect(session.peekDraft()).toMatchObject({ ownerUid: 'owner-b', file: fileB });
  });

  it('apaga URL de foto armazenada em A→B→A sem ressuscitar draft antigo', () => {
    const { session, uid$ } = harness();
    session.setEditDraft({
      ownerUid: 'owner-a',
      storedImageUrl: 'https://example.test/private-a',
      storedImageState: '{"blur":true}',
    });
    uid$.next('owner-b');
    uid$.next('owner-a');
    expect(session.peekDraft()).toBeNull();
  });

  it('fecha dados mesmo antes da emissão de uid$ quando termination já começou', () => {
    const { session, auth } = harness();
    session.setCreateDraft(new File(['a'], 'a.jpg'), 'owner-a');
    auth.isTerminatingSnapshot = true;

    expect(session.peekDraft()).toBeNull();
    expect(() => session.setEditDraft({
      ownerUid: 'owner-a',
      storedImageUrl: 'https://example.test/a',
    })).toThrow('Sua sessão mudou');
    expect(session.peekDraft()).toBeNull();
  });
});
