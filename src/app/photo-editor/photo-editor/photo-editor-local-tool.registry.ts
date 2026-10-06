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
      label: 'Ajustar imagem',
      shortLabel: 'Ajustar',
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
