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

  it('remove explicitamente o rascunho', () => {
    service.save('onboarding:user-1', { gender: 'homem' });
    service.remove('onboarding:user-1');
    expect(service.load('onboarding:user-1')).toBeNull();
  });
});
