import { FormControl, FormGroup } from '@angular/forms';
import { fakeAsync, tick } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { ProfileEditDraftFacade } from './profile-edit-draft.facade';

describe('ProfileEditDraftFacade', () => {
  function form() {
    return new FormGroup({
      nickname: new FormControl('Alex'),
      estado: new FormControl('RJ'),
      municipio: new FormControl('Rio de Janeiro'),
      gender: new FormControl('homem'),
      orientation: new FormControl('heterossexual'),
      idade: new FormControl(30),
      partner1Orientation: new FormControl(''),
      partner2Orientation: new FormControl(''),
      descricao: new FormControl(''),
    });
  }

  it('restaura somente campos permitidos e marca o form como dirty', () => {
    const load = vi.fn(() => ({
      nickname: 'Rascunho',
      descricao: 'Texto',
      campoInvalido: 'ignorar',
    }));
    const facade = new ProfileEditDraftFacade({
      load,
      save: vi.fn(),
      remove: vi.fn(),
    } as any);
    const editForm = form();

    facade.bind(editForm, 'u1', () => false);
    facade.restore(editForm);

    expect(load).toHaveBeenCalledWith('profile-edit:u1');
    expect(editForm.get('nickname')?.value).toBe('Rascunho');
    expect(editForm.get('descricao')?.value).toBe('Texto');
    expect(editForm.dirty).toBe(true);
  });

  it('salva rascunho após debounce quando há alterações', fakeAsync(() => {
    const save = vi.fn();
    const facade = new ProfileEditDraftFacade({
      load: vi.fn(() => null),
      save,
      remove: vi.fn(),
    } as any);
    const editForm = form();

    facade.bind(editForm, 'u1', () => false);
    facade.restore(editForm);

    editForm.get('descricao')?.setValue('Nova descrição');
    editForm.markAsDirty();
    tick(500);

    expect(save).toHaveBeenCalledWith(
      'profile-edit:u1',
      expect.objectContaining({
        nickname: 'Alex',
        descricao: 'Nova descrição',
      })
    );
  }));

  it('não salva enquanto o formulário está sendo persistido', fakeAsync(() => {
    const save = vi.fn();
    const facade = new ProfileEditDraftFacade({
      load: vi.fn(() => null),
      save,
      remove: vi.fn(),
    } as any);
    const editForm = form();

    facade.bind(editForm, 'u1', () => true);
    facade.restore(editForm);

    editForm.get('descricao')?.setValue('Nova descrição');
    editForm.markAsDirty();
    tick(500);

    expect(save).not.toHaveBeenCalled();
  }));

  it('descarta e limpa estado dirty', () => {
    const remove = vi.fn();
    const facade = new ProfileEditDraftFacade({
      load: vi.fn(() => null),
      save: vi.fn(),
      remove,
    } as any);
    const editForm = form();

    facade.bind(editForm, 'u1', () => false);
    facade.restore(editForm);
    editForm.markAsDirty();

    facade.discard(editForm);

    expect(remove).toHaveBeenCalledWith('profile-edit:u1');
    expect(editForm.dirty).toBe(false);
  });
});
