import { describe, expect, it } from 'vitest';

import {
  PHOTO_EDITOR_LOCAL_TOOL_GROUPS,
  PHOTO_EDITOR_LOCAL_TOOL_REGISTRY,
  isLocalPhotoEditorTool,
} from './photo-editor-local-tool.registry';

describe('PHOTO_EDITOR_LOCAL_TOOL_REGISTRY', () => {
  it('mantém todas as ferramentas atuais locais e sem serviço pago', () => {
    expect(
      PHOTO_EDITOR_LOCAL_TOOL_REGISTRY.map((tool) => tool.value)
    ).toEqual([
      'move',
      'crop',
      'adjust',
      'blur',
      'pixelate',
      'bar',
      'emoji',
      'text',
      'datetime',
    ]);

    for (const tool of PHOTO_EDITOR_LOCAL_TOOL_REGISTRY) {
      expect(tool.execution).toBe('local-canvas');
      expect(tool.requiresNetwork).toBe(false);
      expect(tool.requiresPaidService).toBe(false);
    }
  });

  it('organiza a apresentação sem duplicar o registro canônico', () => {
    expect(
      PHOTO_EDITOR_LOCAL_TOOL_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        tools: group.tools.map((tool) => tool.value),
      }))
    ).toEqual([
      {
        id: 'adjustment',
        label: 'Ajustar',
        tools: ['move', 'crop', 'adjust'],
      },
      {
        id: 'privacy',
        label: 'Privacidade',
        tools: ['blur', 'pixelate', 'bar'],
      },
      {
        id: 'decoration',
        label: 'Elementos',
        tools: ['emoji', 'text', 'datetime'],
      },
    ]);

    const groupedTools = PHOTO_EDITOR_LOCAL_TOOL_GROUPS.flatMap(
      (group) => group.tools
    );
    expect(new Set(groupedTools)).toEqual(
      new Set(PHOTO_EDITOR_LOCAL_TOOL_REGISTRY)
    );
  });

  it('expõe uma fronteira única para ferramentas suportadas', () => {
    expect(isLocalPhotoEditorTool('blur')).toBe(true);
    expect(isLocalPhotoEditorTool('crop')).toBe(true);
    expect(isLocalPhotoEditorTool('adjust')).toBe(true);
    expect(isLocalPhotoEditorTool('bar')).toBe(true);
    expect(isLocalPhotoEditorTool('future-remote-tool')).toBe(false);
  });
});
