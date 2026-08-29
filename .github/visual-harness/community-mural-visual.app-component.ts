import { Component } from '@angular/core';
import { NEVER, of } from 'rxjs';

import { AuthSessionService } from '../../src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../src/app/core/services/error-handler/global-error-handler.service';
import { GeolocationService } from '../../src/app/core/services/geolocation/geolocation.service';
import { PhotoEditorLauncherService } from '../../src/app/core/services/image-handling/photo-editor-launcher.service';
import { StorageService } from '../../src/app/core/services/image-handling/storage.service';
import { CameraCaptureService } from '../../src/app/core/services/media/camera-capture.service';
import { CommunityFeedCommentRepository } from '../../src/app/community/data-access/community-feed-comment.repository';
import type { CommunityFeedCommentPage } from '../../src/app/community/data-access/community-feed-comment.model';
import { CommunityFeedRepository } from '../../src/app/community/data-access/community-feed.repository';
import type {
  CommunityFeedPage,
  CommunityFeedPostActionRequest,
  CommunityFeedPostCreateRequest,
  CommunityFeedReactionRequest,
} from '../../src/app/community/data-access/community-feed.model';

const now = Date.now();
const image = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop stop-color="#202631"/>
        <stop offset="1" stop-color="#70798a"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="675" fill="url(#g)"/>
    <circle cx="820" cy="260" r="145" fill="#ffffff" opacity=".10"/>
    <rect x="120" y="420" width="760" height="68" rx="34" fill="#ffffff" opacity=".12"/>
  </svg>
`)}`;

const page: CommunityFeedPage = {
  generatedAt: now,
  nextCursor: null,
  items: [
    {
      postId: 'visual-text',
      kind: 'text',
      author: { label: 'Ana', avatarUrl: null },
      text: 'Uma publicação curta para conferir leitura, ações e abertura da conversa sem transformar o Mural em um formulário administrativo.',
      image: null,
      location: null,
      replyTo: null,
      metrics: { commentCount: 2, reactionCount: 8 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: false,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 4 * 60_000,
    },
    {
      postId: 'visual-photo',
      kind: 'photo',
      author: { label: 'Bruno', avatarUrl: null },
      text: 'Registro visual compartilhado pela comunidade.',
      image: { url: image, alt: 'Imagem de teste do Mural' },
      location: null,
      replyTo: {
        postId: 'visual-text',
        authorLabel: 'Ana',
        textPreview: 'Uma publicação curta para conferir leitura e ações.',
        available: true,
      },
      metrics: { commentCount: 0, reactionCount: 3 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: true,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 12 * 60_000,
    },
    {
      postId: 'visual-location',
      kind: 'location',
      author: { label: 'Carla', avatarUrl: null },
      text: 'Ponto aproximado para o encontro do grupo.',
      image: null,
      location: {
        latitude: -22.91,
        longitude: -43.18,
        precision: 'approximate',
      },
      replyTo: null,
      metrics: { commentCount: 1, reactionCount: 1 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: false,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 26 * 60_000,
    },
  ],
};

const comments: CommunityFeedCommentPage = {
  generatedAt: now,
  nextCursor: null,
  items: [
    {
      commentId: 'visual-comment-1',
      author: { label: 'Diego', avatarUrl: null },
      text: 'Gostei da proposta. Ficou fácil acompanhar a conversa.',
      replyTo: null,
      replyCount: 0,
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
      },
      createdAt: now - 3 * 60_000,
    },
    {
      commentId: 'visual-comment-2',
      author: { label: 'Elisa', avatarUrl: null },
      text: 'A resposta continua no contexto da publicação.',
      replyTo: {
        commentId: 'visual-comment-1',
        authorLabel: 'Diego',
        textPreview: 'Gostei da proposta.',
        available: true,
      },
      replyCount: 0,
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
      },
      createdAt: now - 2 * 60_000,
    },
  ],
};

const visualFeedRepository = {
  getPage$: () => of(page),
  getItems$: ({ postIds }: { postIds: readonly string[] }) => of({
    ...page,
    items: page.items.filter((item) => postIds.includes(item.postId)),
  }),
  watchLatestChanges$: () => NEVER,
  createPost$: (request: CommunityFeedPostCreateRequest) => of({
    communityId: request.communityId,
    postId: 'visual-created-post',
    created: true,
    deduplicated: false,
  }),
  moderatePost$: (request: CommunityFeedPostActionRequest) => of({
    communityId: request.communityId,
    postId: request.postId,
    action: request.action,
    status: request.action === 'delete_own' ? 'deleted' : 'removed',
    deduplicated: false,
    generatedAt: Date.now(),
  }),
  toggleReaction$: (request: CommunityFeedReactionRequest) => of({
    communityId: request.communityId,
    postId: request.postId,
    reacted: true,
    reactionCount: 9,
  }),
};

const visualCommentRepository = {
  getPage$: () => of(comments),
  getRepliesPage$: () => of({
    items: [],
    nextCursor: null,
    generatedAt: Date.now(),
  }),
  watchCommentCount$: () => of(2),
  createComment$: (request: { communityId: string; postId: string }) => of({
    communityId: request.communityId,
    postId: request.postId,
    commentId: 'visual-created-comment',
    commentCount: 3,
    created: true,
    deduplicated: false,
  }),
  createReply$: (request: {
    communityId: string;
    postId: string;
    commentId: string;
  }) => of({
    communityId: request.communityId,
    postId: request.postId,
    commentId: request.commentId,
    replyId: 'visual-created-reply',
    replyCount: 1,
    created: true,
    deduplicated: false,
  }),
  moderateComment$: () => NEVER,
  moderateReply$: () => NEVER,
};

@Component({
  selector: 'app-root',
  standalone: false,
  providers: [
    { provide: CommunityFeedRepository, useValue: visualFeedRepository },
    { provide: CommunityFeedCommentRepository, useValue: visualCommentRepository },
    {
      provide: ErrorNotificationService,
      useValue: {
        showSuccess: () => undefined,
        showWarning: () => undefined,
        showError: () => undefined,
      },
    },
    {
      provide: GlobalErrorHandlerService,
      useValue: { handleError: (error: unknown) => console.error(error) },
    },
    {
      provide: GeolocationService,
      useValue: {
        currentPosition$: () => of({ latitude: -22.91, longitude: -43.18 }),
      },
    },
    {
      provide: AuthSessionService,
      useValue: { currentAuthUser: { uid: 'visual-user' } },
    },
    {
      provide: StorageService,
      useValue: {
        uploadFile: () => of('community-feed/visual-image.webp'),
      },
    },
    { provide: CameraCaptureService, useValue: {} },
    { provide: PhotoEditorLauncherService, useValue: {} },
  ],
  template: `
    <main class="visual-shell">
      <header class="visual-shell__header">
        <p class="visual-shell__eyebrow">Comunidade</p>
        <h1>Mural</h1>
        <p>Validação isolada da superfície real do Mural.</p>
      </header>
      <app-community-feed
        communityId="visual-community"
        [canInteract]="true"
        viewerRole="member"
      />
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .visual-shell { width: min(100%, 760px); margin: 0 auto; padding: 24px 16px 64px; }
    .visual-shell__header { padding: 8px 4px 18px; }
    .visual-shell__header h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.15rem); }
    .visual-shell__header p { margin: 6px 0 0; }
    .visual-shell__eyebrow { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    @media (max-width: 480px) { .visual-shell { padding: 12px 8px 40px; } }
  `],
})
export class AppComponent {}
