import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalDraftService } from './local-draft.service';

describe('LocalDraftService', () => {
  let service: LocalDraftService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(LocalDraftService);
  });

  it('salva e restaura somente dados JSON simples', () => {
    expect(service.save('profile:user-1', {
      nickname: 'Alex',
      estado: 'RJ',
      nested: { enabled: true },
    })).toBe(true);

    expect(service.load('profile:user-1')).toEqual({
      nickname: 'Alex',
      estado: 'RJ',
      nested: { enabled: true },
    });
  });

  it('remove rascunho expirado', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    service.save('room:new', { roomName: 'Sala' }, 60_000);

    nowSpy.mockReturnValue(1_061_000);
    expect(service.load('room:new')).toBeNull();
    nowSpy.mockRestore();
  });

  it('não persiste arquivos dentro do payload', () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });

    expect(service.save('upload:test', {
      title: 'Foto',
      file,
    })).toBe(true);

    expect(service.load('upload:test')).toEqual({
      title: 'Foto',
      file: null,
    });
  });

  it('filtra novos rascunhos de conclusão de cadastro', () => {
    service.save('profile-completion:user-1', {
      nickname: 'Alex', gender: 'homem', estado: 'RJ', orientation: 'bissexual', municipio: 'Rio de Janeiro',
    });

    const raw = localStorage.getItem('entretenimento:draft:v1:profile-completion:user-1')!;
    expect(JSON.parse(raw).value).toEqual({ nickname: 'Alex', gender: 'homem', estado: 'RJ' });
  });

  it('limpa rascunhos antigos de todas as contas e preserva o prazo e as outras chaves', () => {
    const prefix = 'entretenimento:draft:v1:';
    const now = Date.now();
    const legacy = {
      version: 1,
      savedAt: now - 60_000,
      expiresAt: now + 60_000,
      value: {
        nickname: 'Alex', gender: 'homem', estado: 'RJ', orientation: 'bissexual', municipio: 'Rio de Janeiro',
      },
    };
    localStorage.setItem(prefix + 'profile-completion:user-1', JSON.stringify(legacy));
    localStorage.setItem(prefix + 'profile-completion:user-2', JSON.stringify(legacy));
    localStorage.setItem(prefix + 'profile-completion:expired', JSON.stringify({ ...legacy, expiresAt: now - 1 }));
    localStorage.setItem(prefix + 'profile-completion:malformed', '{');
    localStorage.setItem(prefix + 'other:user-1', JSON.stringify(legacy));

    service.migrateProfileCompletionDrafts();

    for (const key of ['profile-completion:user-1', 'profile-completion:user-2']) {
      const raw = localStorage.getItem(prefix + key)!;
      expect(JSON.parse(raw)).toEqual({
        ...legacy,
        value: { nickname: 'Alex', gender: 'homem', estado: 'RJ' },
      });
    }
    expect(localStorage.getItem(prefix + 'profile-completion:expired')).toBeNull();
    expect(localStorage.getItem(prefix + 'profile-completion:malformed')).toBeNull();
    expect(localStorage.getItem(prefix + 'other:user-1')).toBe(JSON.stringify(legacy));
  });

  it('remove explicitamente o rascunho', () => {
    service.save('onboarding:user-1', { gender: 'homem' });
    service.remove('onboarding:user-1');
    expect(service.load('onboarding:user-1')).toBeNull();
  });
});
