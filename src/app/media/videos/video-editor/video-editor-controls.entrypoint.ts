// Entrada canônica do editor de vídeo da plataforma.
//
// Novos consumidores devem importar deste arquivo. A implementação visual
// vive neste mesmo contexto canônico; o caminho antigo de profile-videos é
// mantido apenas como compatibilidade durante a migração de consumidores.

export {
  VideoSimpleEditorControlsComponent,
  type IVideoSimpleEditorState,
  type TVideoEditorTool,
} from './video-simple-editor-controls.component';
