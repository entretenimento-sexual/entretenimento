// scripts/quality/check-media-ux-harmony-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA UX HARMONY BOUNDARY
// -----------------------------------------------------------------------------
// Mantém Foto e Vídeo alinhados em apresentação sem fundir seus runtimes:
// - badges canônicos;
// - contexto de recomendação canônico;
// - estados/skeletons compartilhados;
// - shell/tokens comuns de viewer;
// - editor de Fotos local/Canvas, extensível por registry e sem SaaS pago.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[media-ux-harmony] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[media-ux-harmony] ' + label + ': ' + fragment);
  }
}

const presentation = read(
  'src/app/media/shared/presentation/public-media-presentation.policy.ts'
);

for (const fragment of [
  "'Do perfil'",
  "'Da sua rede'",
  "'Sugestão para você'",
  "'Recente'",
  "'Em alta'",
  "'Patrocinado'",
  "'Descoberta'",
  "source === 'sponsored' || source === 'boosted'",
]) {
  requireIncludes(
    presentation,
    fragment,
    'recommendation context drift'
  );
}

const badge = read(
  'src/app/media/shared/components/public-media-badge/public-media-badge.component.ts'
);
for (const fragment of [
  "'official'",
  "'sponsored'",
  "'cover'",
  "'context'",
]) {
  requireIncludes(badge, fragment, 'shared badge contract drift');
}

for (const relativePath of [
  'src/app/media/shared/components/public-photo-card/public-photo-card.component.ts',
  'src/app/media/shared/components/public-video-card/public-video-card.component.ts',
  'src/app/media/photos/photo-viewer/photo-viewer.component.ts',
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts',
]) {
  requireIncludes(
    read(relativePath),
    'PublicMediaBadgeComponent',
    relativePath + ' must use shared badges'
  );
}

for (const relativePath of [
  'src/app/media/shared/components/public-photo-card/public-photo-card.component.ts',
  'src/app/media/shared/components/public-video-card/public-video-card.component.ts',
]) {
  requireIncludes(
    read(relativePath),
    'PublicMediaRecommendationBadgeComponent',
    relativePath + ' must use shared recommendation badges'
  );
}

for (const relativePath of [
  'src/app/media/photos/photo-viewer/photo-viewer.component.ts',
  'src/app/media/photos/photo-viewer/public-mixed-photo-viewer.component.ts',
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts',
  'src/app/media/videos/public-video-viewer/public-mixed-video-viewer.component.ts',
]) {
  const source = read(relativePath);

  requireIncludes(
    source,
    'PublicMediaBadgeComponent',
    relativePath + ' must import shared badges for its viewer template'
  );
  requireIncludes(
    source,
    'PublicMediaRecommendationBadgeComponent',
    relativePath + ' must use shared recommendation context'
  );
}

for (const relativePath of [
  'src/app/media/photos/photo-viewer/photo-viewer.component.html',
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.html',
]) {
  const source = read(relativePath);
  requireIncludes(
    source,
    'app-public-media-viewer',
    relativePath + ' must consume shared viewer shell tokens'
  );
  requireIncludes(
    source,
    'app-public-media-recommendation-badge',
    relativePath + ' recommendation badge missing'
  );
}

const contentState = read('src/app/shared/content-state/content-state.component.ts');
for (const fragment of [
  "'media-grid'",
  "'viewer'",
  'skeletonVariant',
]) {
  requireIncludes(contentState, fragment, 'content state skeleton contract drift');
}

for (const relativePath of [
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.html',
  'src/app/media/videos/public-profile-videos/public-profile-videos.component.html',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
]) {
  const source = read(relativePath);
  requireIncludes(
    source,
    'app-content-state',
    relativePath + ' must use shared content state'
  );
  requireIncludes(
    source,
    'skeletonVariant="media-grid"',
    relativePath + ' must use media-grid skeleton'
  );
}

const photoProfileGallery = read(
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.html'
);
for (const fragment of [
  'app-public-photo-card',
  'variant="profile"',
]) {
  requireIncludes(
    photoProfileGallery,
    fragment,
    'photo profile gallery shared-card drift'
  );
}

const videoProfileGallery = read(
  'src/app/media/videos/public-profile-videos/public-profile-videos.component.html'
);
for (const fragment of [
  'app-public-video-card',
  'variant="profile"',
  'recommendationSource="profile"',
]) {
  requireIncludes(
    videoProfileGallery,
    fragment,
    'video profile gallery shared-card drift'
  );
}
for (const forbidden of [
  'class="video-card"',
  'class="video-card__preview"',
  '[appPublicVideoMetadataPreload]',
]) {
  forbidIncludes(
    videoProfileGallery,
    forbidden,
    'profile video gallery must not reimplement shared video card'
  );
}

const videoProfileController = read(
  'src/app/media/videos/public-profile-videos/public-profile-videos.component.ts'
);
requireIncludes(
  videoProfileController,
  'PublicVideoViewerLauncherService',
  'profile video gallery must use canonical viewer launcher'
);
forbidIncludes(
  videoProfileController,
  'MatDialog',
  'profile video gallery must not bypass canonical viewer launcher'
);

const viewerTokens = read(
  'src/app/media/shared/styles/public-media-viewer.tokens.css'
);
for (const fragment of [
  '--public-media-viewer-bg',
  '--public-media-viewer-control-bg',
  '--public-media-viewer-control-border',
]) {
  requireIncludes(viewerTokens, fragment, 'viewer token drift');
}

const toolRegistry = read(
  'src/app/photo-editor/photo-editor/photo-editor-local-tool.registry.ts'
);
for (const fragment of [
  'PHOTO_EDITOR_LOCAL_TOOL_REGISTRY',
  "execution: 'local-canvas'",
  'requiresNetwork: false',
  'requiresPaidService: false',
]) {
  requireIncludes(toolRegistry, fragment, 'photo editor local registry drift');
}

const photoEditor = read(
  'src/app/photo-editor/photo-editor/photo-editor.component.ts'
);
requireIncludes(
  photoEditor,
  'PHOTO_EDITOR_LOCAL_TOOL_REGISTRY',
  'photo editor must consume local tool registry'
);
requireIncludes(
  photoEditor,
  "editor: 'native-canvas'",
  'photo editor must remain native Canvas'
);

const photoEditorRuntime = [
  'src/app/photo-editor/photo-editor/photo-editor.component.ts',
  'src/app/photo-editor/photo-editor/photo-editor-overlay.model.ts',
  'src/app/photo-editor/photo-editor/photo-editor-local-tool.registry.ts',
  'src/app/core/services/image-handling/photo-editor-launcher.service.ts',
  'src/app/core/services/image-handling/photo-editor-session.service.ts',
  'src/app/core/services/image-handling/photo-editor-history.service.ts',
  'src/app/core/services/image-handling/photo-editor-result.model.ts',
].map(read).join('\n');

const rootPackage = read('package.json');

for (const forbidden of [
  'HttpClient',
  'httpsCallable',
  'XMLHttpRequest',
  'fetch(',
  'cloudinary',
  'imgix',
  'photopea',
  'remove.bg',
  'replicate.com',
  'adobe.com',
  'canva.com',
  'pintura',
  '@pqina',
  'doka',
  'cropperjs',
  'fabric',
  'konva',
]) {
  forbidIncludes(
    photoEditorRuntime.toLowerCase(),
    forbidden.toLowerCase(),
    'photo editor must not depend on remote/paid editing service'
  );
}

for (const forbiddenPackage of [
  '"@pqina/',
  '"pintura',
  '"doka',
  '"cropperjs"',
  '"fabric"',
  '"konva"',
]) {
  forbidIncludes(
    rootPackage.toLowerCase(),
    forbiddenPackage.toLowerCase(),
    'photo editor must not depend on third-party editing runtime'
  );
}

console.log(
  '[media-ux-harmony] OK: Foto/Vídeo share badges, recommendation context, states, skeletons and viewer tokens; Photo Editor remains local Canvas and registry-extensible.'
);


const profilePhotosTemplate = read(
  'src/app/media/photos/profile-photos/profile-photos.component.html'
);
const profilePhotosComponent = read(
  'src/app/media/photos/profile-photos/profile-photos.component.ts'
);

for (const forbidden of [
  'A publicar',
  '>Publicadas<',
  '(click)="publishPhoto(',
  'confirmDeleteId',
  'delete-confirm-box',
]) {
  if (profilePhotosTemplate.includes(forbidden)) {
    throw new Error(
      '[media-ux-harmony] profile photos voltou a expor estado/ação redundante: ' +
      forbidden
    );
  }
}

for (const forbidden of [
  'publishPhoto(item:',
  'confirmDeleteIdSubject',
  'cancelDelete(',
  'confirmDelete(item:',
]) {
  if (profilePhotosComponent.includes(forbidden)) {
    throw new Error(
      '[media-ux-harmony] profile photos voltou ao fluxo manual/inline legado: ' +
      forbidden
    );
  }
}

requireIncludes(profilePhotosComponent, [
  'ConfirmationDialogComponent',
  "title: 'Excluir foto?'",
  "confirmLabel: 'Excluir foto'",
], 'profile photo deletion confirmation');

requireIncludes(profilePhotosTemplate, [
  '@if (total >= 4)',
  'aria-label="Ordenar fotos"',
], 'profile photo compact gallery controls');


const photoUploadTemplate = read(
  'src/app/media/photos/photo-upload/photo-upload.component.html'
);
const photoUploadComponent = read(
  'src/app/media/photos/photo-upload/photo-upload.component.ts'
);

for (const forbidden of [
  'Foto publicada</h2>',
  'Adicionar outra',
  "phase === 'DONE'",
  'sendAnotherPhoto()',
]) {
  if (
    photoUploadTemplate.includes(forbidden) ||
    photoUploadComponent.includes(forbidden)
  ) {
    throw new Error(
      '[media-ux-harmony] photo upload voltou ao sucesso intermediário redundante: ' +
      forbidden
    );
  }
}

requireIncludes(photoUploadComponent, [
  "this.errorNotifier.showSuccess('Foto adicionada.')",
  "navigate(['/media', 'perfil', ownerUid, 'fotos'])",
], 'photo upload direct return to gallery');

requireIncludes(profilePhotosTemplate, [
  'app-media-action-menu',
  'editLabel="Editar foto"',
  '[showSecondaryAction]="true"',
  'secondaryLabel="Alterar data"',
  '(secondaryAction)="editPhotoDate(item)"',
  'featureLabel="Definir como capa"',
  '(featureAction)="setCoverPhoto(item)"',
  '(deleteRequested)="requestDelete(item)"',
  'photo-date-chip',
], 'profile photo compact action/menu contract');

for (const forbidden of [
  'management-bar',
  'management-date',
  'type="date"',
  '(click)="editPhoto(item, $event)"',
]) {
  forbidIncludes(
    profilePhotosTemplate,
    forbidden,
    'profile photo card must not restore permanent administrative controls'
  );
}

const mediaActionMenu = read(
  'src/app/media/shared/components/media-action-menu/media-action-menu.component.html'
);
const mediaActionMenuController = read(
  'src/app/media/shared/components/media-action-menu/media-action-menu.component.ts'
);
for (const fragment of [
  'matMenuTriggerFor',
  'class="app-media-action-menu-panel"',
  'Mais ações',
  '{{ editLabel }}',
  'showSecondaryAction',
  '{{ secondaryLabel }}',
  'showFeatureAction',
  'featureCurrentLabel',
  '{{ deleteLabel }}',
]) {
  requireIncludes(
    mediaActionMenu,
    fragment,
    'canonical media action menu drift'
  );
}
for (const fragment of [
  "@Input() editLabel = 'Editar'",
  '@Input() showSecondaryAction = false',
  '@Input() showFeatureAction = false',
  "@Input() deleteLabel = 'Excluir'",
  '@Output() secondaryAction',
  '@Output() featureAction',
  '@Output() deleteRequested',
]) {
  requireIncludes(
    mediaActionMenuController,
    fragment,
    'canonical media action menu contract drift'
  );
}

const globalStyles = read('src/styles.css');
for (const fragment of [
  '.app-media-action-menu-panel.mat-mdc-menu-panel',
  '--mat-menu-container-color',
  '.media-action-menu__danger',
]) {
  requireIncludes(
    globalStyles,
    fragment,
    'canonical media action menu theme drift'
  );
}

const mediaDateDialog = read(
  'src/app/media/shared/components/media-date-dialog/media-date-dialog.component.html'
);
requireIncludes(mediaDateDialog, [
  'type="date"',
  'Salvar',
  'Cancelar',
], 'canonical media date dialog drift');


const profileVideosTemplate = read(
  'src/app/media/videos/profile-videos/profile-videos.component.html'
);
const profileVideosComponent = read(
  'src/app/media/videos/profile-videos/profile-videos.component.ts'
);
const profileVideosStyles = read(
  'src/app/media/videos/profile-videos/profile-videos.component.css'
);
const profileVideosSettingsStyles = read(
  'src/app/media/videos/profile-videos/profile-videos-settings.component.css'
);

requireIncludes(profileVideosComponent, [
  'MediaActionMenuComponent',
], 'profile video canonical media action menu import');

requireIncludes(profileVideosTemplate, [
  'app-media-action-menu',
  'editLabel="Editar informações"',
  'deleteLabel="Excluir vídeo"',
  '(edit)="startEditingPublication(item)"',
  '(deleteRequested)="requestDelete(item)"',
], 'profile video compact action/menu contract');

for (const forbidden of [
  'class="profile-videos__actions"',
  'class="profile-videos__delete-button"',
  '>Editar</button>',
]) {
  forbidIncludes(
    profileVideosTemplate,
    forbidden,
    'profile video card must not restore permanent administrative actions'
  );
}

for (const forbidden of [
  '.profile-videos__actions',
  '.profile-videos__delete-button',
]) {
  forbidIncludes(
    profileVideosStyles,
    forbidden,
    'profile video legacy action-bar styles must stay removed'
  );
}

requireIncludes(
  profileVideosStyles,
  '.profile-videos__action-menu',
  'profile video overflow menu placement'
);


for (const forbidden of [
  ">Publicar<",
  "Vídeo enviado para publicação.",
  "aguardando publicação",
  "em preparação para publicação",
]) {
  if (
    profileVideosTemplate.includes(forbidden) ||
    profileVideosComponent.includes(forbidden)
  ) {
    throw new Error(
      '[media-ux-harmony] profile videos voltou a expor publicação manual/transitória: ' +
      forbidden
    );
  }
}

requireIncludes(profileVideosTemplate, [
  "Adicionar vídeo",
], 'profile video automatic publication action');

requireIncludes(profileVideosComponent, [
  "this.errorNotification.showSuccess('Vídeo adicionado.')",
  "return 'Vídeo em preparação.'",
  "return 'Vídeo indisponível.'",
  "return 'Finalizando vídeo.'",
], 'profile video automatic publication feedback');


for (const forbidden of [
  'profile-videos__meta',
  'Tamanho do vídeo',
]) {
  forbidIncludes(
    profileVideosTemplate,
    forbidden,
    'profile video gallery must not expose diagnostic file metadata'
  );
}

requireIncludes(profileVideosComponent, [
  "return 'Preparando'",
  "return 'Finalizando'",
  "return 'Em revisão'",
  "return 'Indisponível'",
], 'profile video meaningful state labels');


requireIncludes(profileVideosTemplate, [
  'class="profile-videos__upload-options"',
  '<summary>Detalhes e interações</summary>',
  'class="profile-videos__upload-primary-action"',
], 'profile video progressive upload disclosure');

for (const forbidden of [
  '<summary>Opções</summary>',
  'videoEditorComposerTop\n                      class="profile-videos__settings-form',
]) {
  forbidIncludes(
    profileVideosTemplate,
    forbidden,
    'profile video upload must not restore always-visible administrative settings'
  );
}

for (const forbidden of [
  '.profile-videos__actions',
  '.profile-videos__delete-button',
]) {
  forbidIncludes(
    profileVideosSettingsStyles,
    forbidden,
    'profile video settings stylesheet must not restore legacy card actions'
  );
}

requireIncludes(profileVideosSettingsStyles, [
  '.profile-videos__upload-options',
  '.profile-videos__upload-primary-action',
], 'profile video progressive upload styles');


const videoEditorTemplate = read(
  'src/app/media/videos/video-editor/video-simple-editor-controls.component.html'
);
const videoEditorComponent = read(
  'src/app/media/videos/video-editor/video-simple-editor-controls.component.ts'
);
const videoEditorStyles = read(
  'src/app/media/videos/video-editor/video-simple-editor-controls.component.css'
);

requireIncludes(videoEditorComponent, [
  "signal<TVideoEditorTool | null>(null)",
  "current === tool ? null : tool",
], 'video editor progressive tools state');

requireIncludes(videoEditorTemplate, [
  '@if (timeline && activeTool())',
  '<span>Cortar</span>',
  '<span>Formato</span>',
  '<span>Girar</span>',
  '<span>Áudio</span>',
  '<span>Capa</span>',
], 'video editor progressive tool disclosure');

forbidIncludes(
  videoEditorStyles,
  '.video-simple-editor__tool-tabs button span {\n    display: none;',
  'video editor desktop tools must remain self-explanatory'
);


requireIncludes(videoEditorComponent, [
  "if (this.disabled) {",
  "this.activeTool.update((current) => current === tool ? null : tool);",
], 'video editor tool toggle behavior');

requireIncludes(videoEditorStyles, [
  'grid-template-columns: repeat(3, minmax(0, 1fr));',
], 'video editor readable desktop tool grid');
