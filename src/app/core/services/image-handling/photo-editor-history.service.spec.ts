import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { describe, expect, it } from 'vitest';

import {
  PHOTO_EDITOR_HISTORY_LIMIT,
  PhotoEditorHistoryService,
} from './photo-editor-history.service';

describe('PhotoEditorHistoryService', () => {
  function snapshot(state: string, selectedOverlayId: string | null = null) {
    return { state, selectedOverlayId };
  }

  function nativeState(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: 2,
      editor: 'native-canvas',
      flattened: true,
      rotation: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
      aspectRatio: 'original',
      overlays: [],
      ...overrides,
    });
  }

  it('inicia e reinicia o histórico com um único estado canônico', () => {
    const service = new PhotoEditorHistoryService();

    service.reset(snapshot('{"rotation":0}'));

    expect(service.current).toEqual(snapshot('{"rotation":0}'));
    expect(service.size).toBe(1);
    expect(service.canUndo).toBe(false);
    expect(service.canRedo).toBe(false);
  });

  it('ignora estado duplicado sem perder a seleção efêmera atual', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('{"rotation":0}', null));

    const createdEntry = service.commit(
      snapshot('{"rotation":0}', 'overlay-1')
    );

    expect(createdEntry).toBe(false);
    expect(service.size).toBe(1);
    expect(service.current).toEqual(
      snapshot('{"rotation":0}', 'overlay-1')
    );
  });

  it('desfaz e refaz estados completos na ordem correta', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('{"rotation":0}'));
    service.commit(snapshot('{"rotation":90}'));
    service.commit(snapshot('{"rotation":90,"zoom":1.5}'));

    expect(service.undo()).toEqual(snapshot('{"rotation":90}'));
    expect(service.undo()).toEqual(snapshot('{"rotation":0}'));
    expect(service.undo()).toBeNull();

    expect(service.redo()).toEqual(snapshot('{"rotation":90}'));
    expect(service.redo()).toEqual(
      snapshot('{"rotation":90,"zoom":1.5}')
    );
    expect(service.redo()).toBeNull();
  });

  it('agrupa alterações contínuas de zoom em uma única etapa de undo', () => {
    const service = new PhotoEditorHistoryService();
    const initial = nativeState();
    service.reset(snapshot(initial));

    service.commit(snapshot(nativeState({ zoom: 1.05 })));
    service.commit(snapshot(nativeState({ zoom: 1.1 })));
    service.commit(snapshot(nativeState({ zoom: 1.15 })));

    expect(service.size).toBe(2);
    expect(service.current?.state).toBe(nativeState({ zoom: 1.15 }));
    expect(service.undo()).toEqual(snapshot(initial));
  });

  it('agrupa movimento contínuo sem misturar outras ferramentas', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot(nativeState()));

    service.commit(snapshot(nativeState({ panX: 0.02 })));
    service.commit(snapshot(nativeState({ panX: 0.04, panY: 0.01 })));
    expect(service.size).toBe(2);

    service.commit(snapshot(nativeState({ panX: 0.04, panY: 0.01, rotation: 90 })));
    expect(service.size).toBe(3);
  });

  it('descarta a ramificação de redo quando chega uma nova edição', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('estado-0'));
    service.commit(snapshot('estado-1'));
    service.commit(snapshot('estado-2'));

    service.undo();
    expect(service.canRedo).toBe(true);

    service.commit(snapshot('estado-3'));

    expect(service.current).toEqual(snapshot('estado-3'));
    expect(service.canRedo).toBe(false);
    expect(service.redo()).toBeNull();
  });

  it('mantém o histórico limitado sem duplicar mídia pesada', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('estado-0'));

    for (let index = 1; index <= PHOTO_EDITOR_HISTORY_LIMIT + 10; index += 1) {
      service.commit(snapshot(`estado-${index}`));
    }

    expect(service.size).toBe(PHOTO_EDITOR_HISTORY_LIMIT);
    expect(service.current).toEqual(
      snapshot(`estado-${PHOTO_EDITOR_HISTORY_LIMIT + 10}`)
    );

    let undoCount = 0;
    while (service.undo()) {
      undoCount += 1;
    }
    expect(undoCount).toBe(PHOTO_EDITOR_HISTORY_LIMIT - 1);
  });

  it('expõe canUndo e canRedo de forma reativa', async () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('estado-0'));

    const undoEnabled = firstValueFrom(
      service.canUndo$.pipe(filter((value) => value))
    );
    service.commit(snapshot('estado-1'));

    await expect(undoEnabled).resolves.toBe(true);

    service.undo();
    await expect(firstValueFrom(service.canRedo$)).resolves.toBe(true);
  });

  it('limpa a sessão sem deixar estado navegável', () => {
    const service = new PhotoEditorHistoryService();
    service.reset(snapshot('estado-0'));
    service.commit(snapshot('estado-1'));

    service.clear();

    expect(service.current).toBeNull();
    expect(service.size).toBe(0);
    expect(service.canUndo).toBe(false);
    expect(service.canRedo).toBe(false);
  });

  it('rejeita snapshot sem estado serializado', () => {
    const service = new PhotoEditorHistoryService();

    expect(() => service.reset(snapshot('   '))).toThrowError(
      'O histórico do editor requer um estado serializado válido.'
    );
  });
});
