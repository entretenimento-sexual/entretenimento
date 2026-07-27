// src/app/store/room-store-boundary.architecture.spec.ts
import { describe, expect, it } from 'vitest';

import { STORE_FEATURE } from './reducers/feature-keys';
import { reducers } from './reducers';

describe('room store ownership boundary', () => {
  it('não registra uma segunda slice global para salas', () => {
    expect(Object.values(STORE_FEATURE)).not.toContain('room');
    expect(Object.keys(reducers)).not.toContain('room');
  });
});
