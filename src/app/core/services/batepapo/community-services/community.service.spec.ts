// src/app/core/services/batepapo/community-services/community.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';

import { CommunityService } from './community.service';

describe('CommunityService', () => {
  let service: CommunityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CommunityService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('deve bloquear criação direta pelo fluxo legado', async () => {
    await expect(
      service.createCommunity({} as never)
    ).rejects.toThrow('fluxo legado');
  });

  it('deve bloquear enumeração direta de membros', async () => {
    await expect(
      firstValueFrom(service.observeCommunityMembers('community-1'))
    ).rejects.toThrow('fluxo legado');
  });
});
