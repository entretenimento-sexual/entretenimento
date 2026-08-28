// src/test/ngrx-store-testing.providers.ts
import { Provider } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import { VitestMockFn } from './angular-error-testing.providers';

export interface StoreTestingMock<TState = unknown> {
  select: VitestMockFn;
  dispatch: VitestMockFn;
  pipe: VitestMockFn;
  source?: Observable<TState>;
}

export interface StoreTestingMockOptions {
  defaultSelectorValue?: unknown;
  selectorValues?: Map<unknown, unknown>;
}

export function createStoreTestingMock<TState = unknown>(
  options: StoreTestingMockOptions = {}
): StoreTestingMock<TState> {
  const defaultSelectorValue = options.defaultSelectorValue ?? null;
  const selectorValues = options.selectorValues ?? new Map<unknown, unknown>();

  return {
    select: vi.fn((selector: unknown) => {
      if (selectorValues.has(selector)) {
        return of(selectorValues.get(selector));
      }

      return of(defaultSelectorValue);
    }),
    dispatch: vi.fn(),
    pipe: vi.fn(() => of(defaultSelectorValue)),
    source: of({} as TState),
  };
}

export function provideStoreTestingMock<TState = unknown>(
  storeMock: StoreTestingMock<TState>
): Provider[] {
  return [
    {
      provide: Store,
      useValue: storeMock,
    },
  ];
}
