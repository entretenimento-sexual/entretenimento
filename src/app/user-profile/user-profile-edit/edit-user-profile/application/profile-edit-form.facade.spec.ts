import { FormBuilder } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileEditLocationService } from './profile-edit-location.service';
import { ProfileEditFormFacade } from './profile-edit-form.facade';

describe('ProfileEditFormFacade', () => {
  function setup() {
    const loadMunicipios$ = vi.fn((sigla: string) =>
      of(
        sigla === 'RJ'
          ? [
              { id: 1, nome: 'Rio de Janeiro' },
              { id: 2, nome: 'Niterói' },
            ]
          : []
      )
    );

    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        ProfileEditFormFacade,
        {
          provide: ProfileEditLocationService,
          useValue: { loadMunicipios$ },
        },
      ],
    });

    return {
      facade: TestBed.inject(ProfileEditFormFacade),
      loadMunicipios$,
    };
  }

  it('faz patch inicial do perfil mantendo os mesmos campos', () => {
    const { facade } = setup();

    facade.initialize(
      {
        uid: 'u1',
        nickname: 'Alex',
        estado: 'RJ',
        municipio: 'Niterói',
        gender: 'masculino',
        orientation: 'bissexual',
        idade: 34,
        descricao: 'Descrição',
      } as any,
      [
        { id: 1, nome: 'Rio de Janeiro' },
        { id: 2, nome: 'Niterói' },
      ]
    );

    expect(facade.form.getRawValue()).toMatchObject({
      nickname: 'Alex',
      estado: 'RJ',
      municipio: 'Niterói',
      gender: 'masculino',
      orientation: 'bissexual',
      idade: 34,
      descricao: 'Descrição',
    });
    expect(facade.municipios()).toHaveLength(2);
  });

  it('alterna controles de orientação para perfil de casal', () => {
    const { facade } = setup();
    facade.bind();

    facade.form.patchValue({ orientation: 'heterossexual' });
    facade.form.patchValue({ gender: 'casal-ele-ela' });

    expect(facade.isCouple()).toBe(true);
    expect(facade.form.get('orientation')?.disabled).toBe(true);
    expect(facade.form.get('orientation')?.value).toBe('');
    expect(facade.form.get('partner1Orientation')?.enabled).toBe(true);
    expect(facade.form.get('partner2Orientation')?.enabled).toBe(true);
  });

  it('restaura orientação individual e limpa campos de casal', () => {
    const { facade } = setup();
    facade.bind();

    facade.form.patchValue({
      gender: 'casal-ele-ela',
      partner1Orientation: 'bissexual',
      partner2Orientation: 'pansexual',
    });
    facade.form.patchValue({ gender: 'masculino' });

    expect(facade.isCouple()).toBe(false);
    expect(facade.form.get('orientation')?.enabled).toBe(true);
    expect(facade.form.get('partner1Orientation')?.disabled).toBe(true);
    expect(facade.form.get('partner2Orientation')?.disabled).toBe(true);
    expect(facade.form.get('partner1Orientation')?.value).toBe('');
    expect(facade.form.get('partner2Orientation')?.value).toBe('');
  });

  it('carrega municípios ao trocar estado e seleciona o primeiro quando necessário', () => {
    const { facade, loadMunicipios$ } = setup();
    facade.bind();

    facade.form.patchValue({ municipio: 'Cidade antiga' });
    facade.form.patchValue({ estado: 'RJ' });

    expect(loadMunicipios$).toHaveBeenCalledWith('RJ');
    expect(facade.municipios()).toEqual([
      { id: 1, nome: 'Rio de Janeiro' },
      { id: 2, nome: 'Niterói' },
    ]);
    expect(facade.form.get('municipio')?.enabled).toBe(true);
    expect(facade.form.get('municipio')?.value).toBe('Rio de Janeiro');
  });
});
