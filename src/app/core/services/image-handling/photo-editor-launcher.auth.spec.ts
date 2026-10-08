import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PhotoEditorLauncherService } from './photo-editor-launcher.service';
import { PhotoEditorSessionService } from './photo-editor-session.service';

describe('PhotoEditorLauncherService / fim de sessão durante modal', () => {
  it('fecha modal ativo e descarta resultado após logout', async () => {
    const uid$ = new BehaviorSubject<string | null>('owner-a');
    const dismiss = vi.fn();
    const open = vi.fn(() => ({
      result: new Promise<unknown>(() => {}),
      dismiss,
    }));
    const session = {
      setCreateDraft: vi.fn(),
      clearDraft: vi.fn(),
    };
    const report = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        PhotoEditorLauncherService,
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: NgbModal, useValue: { open } },
        { provide: PhotoEditorSessionService, useValue: session },
        { provide: MediaApplicationErrorService, useValue: { report } },
      ],
    });
    const launcher = TestBed.inject(PhotoEditorLauncherService);
    const resultPromise = firstValueFrom(
      launcher.editFile$(new File(['photo'], 'a.jpg', { type: 'image/jpeg' }))
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    uid$.next(null);

    await expect(resultPromise).resolves.toBeNull();
    expect(dismiss).toHaveBeenCalledWith('auth-changed');
    expect(session.clearDraft).toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
