import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { SuggestionService } from './suggestion.service';

function profile(uid: string, gender: string, orientation: string): IUserDados {
  return {
    uid,
    nickname: uid,
    email: 'private@example.test',
    descricao: 'Dado não autorizado para o card',
    isSubscriber: true,
    photoURL: null,
    role: 'premium',
    lastLogin: 99,
    municipio: 'Rio de Janeiro',
    estado: 'RJ',
    gender,
    identityCode: gender,
    orientation,
    idade: 39,
  };
}

describe('SuggestionService / projeção pública', () => {
  it('consulta somente a descoberta pública e transporta uma allowlist visual', async () => {
    const query = {
      getSuggestedProfiles: vi.fn(() => of([
        profile('viewer', 'mulher', 'heterossexual'),
        profile('candidate', 'homem', 'heterossexual'),
        profile('not-matching', 'mulher', 'heterossexual'),
      ])),
      getProfilesByOrientationAndLocation: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        SuggestionService,
        { provide: FirestoreQueryService, useValue: query },
      ],
    });
    const current = profile('viewer', 'mulher', 'heterossexual');
    const result = await firstValueFrom(
      TestBed.inject(SuggestionService).getSuggestedProfilesForUser(current)
    );

    expect(query.getSuggestedProfiles).toHaveBeenCalledWith(120);
    expect(query.getProfilesByOrientationAndLocation).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: 'candidate',
      nickname: 'candidate',
      identityCode: 'homem',
      orientation: 'heterossexual',
      email: null,
    });
    expect(result[0].idade).toBeUndefined();
    expect(result[0].descricao).toBe('');
    expect(result[0].isSubscriber).toBe(false);
    expect(result[0].role).toBe('free');
    expect((result[0] as unknown as Record<string, unknown>)['subscriptionStatus'])
      .toBeUndefined();
  });

  it('não associa orientação individual de casais nem consulta users', async () => {
    const query = {
      getSuggestedProfiles: vi.fn(() => of([
        { ...profile('couple', 'mulher', 'bissexual'), identityCode: 'casal-ele-ela' },
        profile('person', 'homem', 'bissexual'),
      ])),
    };
    TestBed.configureTestingModule({
      providers: [
        SuggestionService,
        { provide: FirestoreQueryService, useValue: query },
      ],
    });
    const result = await firstValueFrom(
      TestBed.inject(SuggestionService).getSuggestedProfilesForUser(
        profile('viewer', 'mulher', 'bissexual')
      )
    );
    expect(result.map((item) => item.uid)).toEqual(['person']);
  });

  it('não realiza descoberta sem localização e declarações reconhecidas', async () => {
    const query = { getSuggestedProfiles: vi.fn(() => of([])) };
    TestBed.configureTestingModule({
      providers: [
        SuggestionService,
        { provide: FirestoreQueryService, useValue: query },
      ],
    });
    const result = await firstValueFrom(
      TestBed.inject(SuggestionService).getSuggestedProfilesForUser({
        ...profile('viewer', 'mulher', 'heterossexual'),
        municipio: undefined,
      })
    );
    expect(result).toEqual([]);
    expect(query.getSuggestedProfiles).not.toHaveBeenCalled();
  });
});
