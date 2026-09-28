import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PhotoEditorLauncherService } from './photo-editor-launcher.service';
import { PhotoEditorSessionService } from './photo-editor-session.service';

describe('PhotoEditorLauncherService', () => {
  function configure(resultPayload: unknown) {
    const sessionMock = {
      setCreateDraft: vi.fn(),
      setEditDraft: vi.fn(),
      clearDraft: vi.fn(),
    };
    const mediaErrorMock = { report: vi.fn() };
    const modalMock = {
      open: vi.fn(() => ({
        result: Promise.resolve(resultPayload),
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        PhotoEditorLauncherService,
        { provide: NgbModal, useValue: modalMock },
        { provide: AuthSessionService, useValue: { uid$: of('u1') } },
        { provide: PhotoEditorSessionService, useValue: sessionMock },
        { provide: MediaApplicationErrorService, useValue: mediaErrorMock },
      ],
    });

    return {
      service: TestBed.inject(PhotoEditorLauncherService),
      sessionMock,
      mediaErrorMock,
      modalMock,
    };
  }

  it('usa o editor canônico como processador e devolve File sem persistir mídia', async () => {
    const source = new File(['original'], 'camera.jpg', { type: 'image/jpeg' });
    const edited = new File(['editada'], 'camera-editada.jpg', { type: 'image/jpeg' });
    const { service, sessionMock, mediaErrorMock } = configure({
      reason: 'processSuccess',
      result: {
        kind: 'image',
        file: edited,
        imageStateStr: '{"version":2}',
        width: 1280,
        height: 720,
        context: 'community-feed',
        preset: 'mural',
        metadataStripped: true,
      },
    });

    const result = await firstValueFrom(
      service.editFile$(source, 'community-feed-camera')
    );

    expect(sessionMock.setCreateDraft).toHaveBeenCalledWith(
      source,
      'u1',
      'community-feed-camera',
      {
        context: undefined,
        preset: undefined,
      }
    );
    expect(result?.file).toBe(edited);
    expect(result).toEqual(expect.objectContaining({
      imageStateStr: '{"version":2}',
      width: 1280,
      height: 720,
      context: 'community-feed',
      preset: 'mural',
      metadataStripped: true,
    }));
    expect(sessionMock.clearDraft).toHaveBeenCalled();
    expect(mediaErrorMock.report).not.toHaveBeenCalled();
  });

  it('edita foto armazenada sem entregar photoId ou storagePath ao editor', async () => {
    const edited = new File(['editada'], 'perfil-editada.webp', { type: 'image/webp' });
    const { service, sessionMock } = configure({
      reason: 'processSuccess',
      result: {
        kind: 'image',
        file: edited,
        imageStateStr: '{"version":2}',
        width: 1024,
        height: 1280,
        context: 'profile-photo',
        preset: 'profile-photo',
        metadataStripped: true,
      },
    });

    const result = await firstValueFrom(
      service.editStoredPhoto$({
        ownerUid: 'u1',
        storedImageUrl: 'https://example.test/foto.webp',
        storedImageState: '{"version":2}',
        fileName: 'perfil.webp',
      })
    );

    expect(sessionMock.setEditDraft).toHaveBeenCalledWith({
      ownerUid: 'u1',
      storedImageUrl: 'https://example.test/foto.webp',
      storedImageState: '{"version":2}',
      fileName: 'perfil.webp',
    });
    expect(result?.file).toBe(edited);
    expect(sessionMock.setCreateDraft).not.toHaveBeenCalled();
  });


  it('reporta ownership inválido pela fronteira canônica de Media', async () => {
    const { service, mediaErrorMock } = configure(null);

    await expect(firstValueFrom(
      service.editStoredPhoto$({
        ownerUid: 'outro-usuario',
        storedImageUrl: 'https://example.test/foto.webp',
      })
    )).rejects.toMatchObject({
      name: 'MediaError',
      reason: 'photo_editor_owner_mismatch',
    });

    expect(mediaErrorMock.report).toHaveBeenCalledTimes(1);
    expect(mediaErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'photo_editor_owner_mismatch',
      }),
      expect.objectContaining({
        operation: 'photoEditor.launch',
        reasonHint: 'photo_editor_failed',
      })
    );
  });

  it('reporta origem ausente pela fronteira canônica de Media', async () => {
    const { service, mediaErrorMock } = configure(null);

    await expect(firstValueFrom(
      service.editStoredPhoto$({
        ownerUid: 'u1',
        storedImageUrl: '   ',
      })
    )).rejects.toMatchObject({
      name: 'MediaError',
      reason: 'photo_editor_source_unavailable',
    });

    expect(mediaErrorMock.report).toHaveBeenCalledTimes(1);
  });
});
