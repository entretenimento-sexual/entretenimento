import type { PhotoEditorTool } from './photo-editor-overlay.model';

export type PhotoEditorLocalToolFamily =
  | 'navigation'
  | 'adjustment'
  | 'privacy'
  | 'decoration';

export interface PhotoEditorLocalToolDefinition {
  readonly value: PhotoEditorTool;
  readonly label: string;
  readonly shortLabel: string;
  readonly family: PhotoEditorLocalToolFamily;
  readonly execution: 'local-canvas';
  readonly requiresNetwork: false;
  readonly requiresPaidService: false;
}

export type PhotoEditorLocalToolGroupId =
  | 'adjustment'
  | 'privacy'
  | 'decoration';

export interface PhotoEditorLocalToolGroupDefinition {
  readonly id: PhotoEditorLocalToolGroupId;
  readonly label: string;
  readonly tools: readonly PhotoEditorLocalToolDefinition[];
}

/**
 * Registro canônico de ferramentas do editor de Fotos.
 *
 * A inclusão de uma nova ferramenta deve começar aqui. O editor continua
 * browser-local/Canvas; integrações remotas, SaaS ou cobrança não fazem parte
 * deste contrato.
 */
export const PHOTO_EDITOR_LOCAL_TOOL_REGISTRY:
  readonly PhotoEditorLocalToolDefinition[] = Object.freeze([
    Object.freeze({
      value: 'move',
      label: 'Mover e selecionar',
      shortLabel: 'Mover',
      family: 'navigation',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'crop',
      label: 'Recorte livre',
      shortLabel: 'Recortar',
      family: 'adjustment',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'adjust',
      label: 'Correções de imagem',
      shortLabel: 'Correções',
      family: 'adjustment',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'blur',
      label: 'Borrar área',
      shortLabel: 'Borrar',
      family: 'privacy',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'pixelate',
      label: 'Pixelar área',
      shortLabel: 'Pixelar',
      family: 'privacy',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'bar',
      label: 'Tarja de privacidade',
      shortLabel: 'Tarja',
      family: 'privacy',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'emoji',
      label: 'Inserir emoji',
      shortLabel: 'Emoji',
      family: 'decoration',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'text',
      label: 'Inserir texto',
      shortLabel: 'Texto',
      family: 'decoration',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
    Object.freeze({
      value: 'datetime',
      label: 'Inserir data e hora',
      shortLabel: 'Data/hora',
      family: 'decoration',
      execution: 'local-canvas',
      requiresNetwork: false,
      requiresPaidService: false,
    }),
  ]);

export function isLocalPhotoEditorTool(value: unknown): value is PhotoEditorTool {
  return PHOTO_EDITOR_LOCAL_TOOL_REGISTRY.some(
    (tool) => tool.value === value
  );
}

const toolsByValue = new Map(
  PHOTO_EDITOR_LOCAL_TOOL_REGISTRY.map((tool) => [tool.value, tool] as const)
);

function resolveGroupTools(
  values: readonly PhotoEditorTool[]
): readonly PhotoEditorLocalToolDefinition[] {
  return Object.freeze(
    values.map((value) => {
      const tool = toolsByValue.get(value);
      if (!tool) {
        throw new Error(`Ferramenta local não registrada: ${value}`);
      }
      return tool;
    })
  );
}

/**
 * Organização visual canônica das ferramentas.
 *
 * Mantém a semântica de execução no registro de ferramentas e concentra aqui
 * apenas a apresentação do editor, evitando listas paralelas no componente.
 */
export const PHOTO_EDITOR_LOCAL_TOOL_GROUPS:
  readonly PhotoEditorLocalToolGroupDefinition[] = Object.freeze([
    Object.freeze({
      id: 'adjustment',
      label: 'Ajustar',
      tools: resolveGroupTools(['move', 'crop', 'adjust']),
    }),
    Object.freeze({
      id: 'privacy',
      label: 'Privacidade',
      tools: resolveGroupTools(['blur', 'pixelate', 'bar']),
    }),
    Object.freeze({
      id: 'decoration',
      label: 'Elementos',
      tools: resolveGroupTools(['emoji', 'text', 'datetime']),
    }),
  ]);
