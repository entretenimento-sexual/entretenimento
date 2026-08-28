// Compatibilidade temporária: o editor visual canônico foi movido para
// src/app/media/videos/video-editor. Consumidores antigos continuam válidos
// até concluirmos a migração de imports, sem duplicar implementação.
export {
  VideoSimpleEditorControlsComponent,
  type IVideoSimpleEditorState,
  type TVideoEditorTool,
} from '../video-editor/video-editor-controls.entrypoint';
