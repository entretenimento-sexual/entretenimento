import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileEditAvatarFacade } from './profile-edit-avatar.facade';

describe('ProfileEditAvatarFacade', () => {
  function setup(input?: {
    editResult?: any;
    uploadResult?: string;
    uploadError?: unknown;
  }) {
    const editFile$ = vi.fn(() =>
      of(
        input?.editResult === undefined
          ? {
              kind: 'image',
              file: new File(['edited'], 'edited.jpg', {
                type: 'image/jpeg',
              }),
              imageStateStr: '{}',
              width: 1024,
              height: 1024,
              context: 'profile-avatar',
              preset: 'avatar-square',
              metadataStripped: true,
            }
          : input.editResult
      )
    );
    const uploadProfileAvatar = vi.fn(() =>
      input?.uploadError
        ? throwError(() => input.uploadError)
        : of(input?.uploadResult ?? 'avatar-url')
    );
    const showError = vi.fn();
    const report = vi.fn();

    const facade = new ProfileEditAvatarFacade(
      { editFile$ } as any,
      { uploadProfileAvatar } as any,
      { showError } as any,
      { report } as any
    );

    return {
      facade,
      editFile$,
      uploadProfileAvatar,
      showError,
      report,
    };
  }

  it('edita com preset canônico e envia o arquivo processado', async () => {
    const { facade, editFile$, uploadProfileAvatar } = setup();
    const source = new File(['original'], 'avatar.jpg', {
      type: 'image/jpeg',
    });

    await expect(
      firstValueFrom(facade.upload$(source, 'u1'))
    ).resolves.toBe('avatar-url');

    expect(editFile$).toHaveBeenCalledWith(source, {
      source: 'profile-avatar',
      context: 'profile-avatar',
      preset: 'avatar-square',
    });
    expect(uploadProfileAvatar).toHaveBeenCalledWith(
      expect.any(File),
      'u1',
      expect.any(Function)
    );
    expect(facade.isEditing()).toBe(false);
    expect(facade.isUploading()).toBe(false);
  });

  it('bloqueia arquivo inválido antes de abrir o editor', () => {
    const { facade, editFile$, uploadProfileAvatar, showError } = setup();
    const source = new File(['invalid'], 'avatar.txt', {
      type: 'text/plain',
    });

    const values: string[] = [];
    facade.upload$(source, 'u1').subscribe((value) => values.push(value));

    expect(values).toEqual([]);
    expect(editFile$).not.toHaveBeenCalled();
    expect(uploadProfileAvatar).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
  });

  it('não envia quando o editor é cancelado', () => {
    const { facade, uploadProfileAvatar } = setup({
      editResult: null,
    });
    const source = new File(['original'], 'avatar.jpg', {
      type: 'image/jpeg',
    });

    facade.upload$(source, 'u1').subscribe();

    expect(uploadProfileAvatar).not.toHaveBeenCalled();
    expect(facade.isEditing()).toBe(false);
  });

  it('diagnostica falha de upload pelo ApplicationErrorService', () => {
    const error = new Error('upload failed');
    const { facade, report } = setup({ uploadError: error });
    const source = new File(['original'], 'avatar.jpg', {
      type: 'image/jpeg',
    });

    facade.upload$(source, 'u1').subscribe();

    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-edit',
      operation: 'ProfileEditAvatarFacade.uploadAvatar',
      fallbackMessage: 'Erro durante o upload da foto.',
      metadata: {
        scope: 'ProfileEditAvatarFacade',
      },
    });
    expect(facade.isEditing()).toBe(false);
    expect(facade.isUploading()).toBe(false);
  });
});
