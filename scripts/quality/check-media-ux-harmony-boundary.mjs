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
  '@if (total > 1)',
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
  '(changeDate)="editPhotoDate(item)"',
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
for (const fragment of [
  'matMenuTriggerFor',
  'Mais ações',
  'Editar foto',
  'Alterar data',
  'Definir como capa',
  'Excluir foto',
]) {
  requireIncludes(
    mediaActionMenu,
    fragment,
    'canonical media action menu drift'
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
