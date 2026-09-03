import { Component } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NEVER, of } from 'rxjs';

import { ContentAccessNavigationService } from './core/access/content-access-navigation.service';
import { AuthSessionService } from './core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from './core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from './core/services/error-handler/global-error-handler.service';
import { GeolocationService } from './core/services/geolocation/geolocation.service';
import { PhotoEditorLauncherService } from './core/services/image-handling/photo-editor-launcher.service';
import { StorageService } from './core/services/image-handling/storage.service';
import { CameraCaptureService } from './core/services/media/camera-capture.service';
import { CommunityFeedCommentRepository } from './community/data-access/community-feed-comment.repository';
import type { CommunityFeedCommentPage } from './community/data-access/community-feed-comment.model';
import { CommunityFeedRepository } from './community/data-access/community-feed.repository';
import type {
  CommunityFeedPage,
  CommunityFeedPostActionRequest,
  CommunityFeedPostCreateRequest,
  CommunityFeedReactionRequest,
} from './community/data-access/community-feed.model';
import { CommunityMembershipRepository } from './community/data-access/community-membership.repository';
import type { CommunityPreviewResponse } from './community/data-access/community-preview.model';
import { CommunityPreviewRepository } from './community/data-access/community-preview.repository';

const now = Date.now();
const visualImage = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop stop-color="#252b36"/>
        <stop offset="1" stop-color="#747f91"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="675" fill="url(#g)"/>
    <circle cx="860" cy="220" r="170" fill="#ffffff" opacity=".10"/>
    <rect x="110" y="430" width="770" height="72" rx="36" fill="#ffffff" opacity=".12"/>
  </svg>
`)}`;

const preview: CommunityPreviewResponse = {
  community: {
    communityId: 'visual-community',
    name: 'Encontros & Conexões RJ',
    slug: 'encontros-conexoes-rj',
    description:
      'Espaço para conhecer pessoas, trocar experiências e organizar encontros com respeito e consentimento.',
    source: { type: 'community', id: 'visual-community' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 86, postCount: 24, mediaCount: 11 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [
      { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
      { id: 'intent:dating', label: 'Encontros', category: 'intent' },
      { id: 'audience:rj', label: 'Rio de Janeiro', category: 'audience' },
    ],
  },
  rules:
    'Respeite os limites das outras pessoas. Não publique dados pessoais de terceiros e mantenha as conversas dentro do contexto da Comunidade.',
  lifecycleStatus: 'active',
  viewerMode: 'member',
  viewerRole: 'member',
  canInteract: true,
  canManageMemberships: false,
  canInviteCommunityMembers: false,
  canManageCommunitySettings: false,
  capacity: {
    memberCount: 86,
    configuredLimit: 100,
    effectiveLimit: 100,
    restrictedByOwnerPlan: false,
    acceptingNewMembers: true,
    memberLimitOptions: [],
    allowedMemberLimits: [],
  },
  settings: null,
  canLeaveMembership: true,
  generatedAt: now,
};

const ownerPreview: CommunityPreviewResponse = {
  ...preview,
  viewerMode: 'manager',
  viewerRole: 'owner',
  canManageMemberships: true,
  canInviteCommunityMembers: true,
  canManageCommunitySettings: true,
  capacity: {
    memberCount: 86,
    configuredLimit: 100,
    effectiveLimit: 100,
    restrictedByOwnerPlan: false,
    acceptingNewMembers: true,
    memberLimitOptions: [
      { memberLimit: 25, requirement: 'basic', allowed: true },
      { memberLimit: 50, requirement: 'basic', allowed: true },
      { memberLimit: 100, requirement: 'basic', allowed: true },
      { memberLimit: 250, requirement: 'premium', allowed: false },
      { memberLimit: 500, requirement: 'vip', allowed: false },
      { memberLimit: 1000, requirement: 'special_access', allowed: false },
    ],
    allowedMemberLimits: [25, 50, 100],
  },
  settings: {
    name: 'Encontros & Conexões RJ',
    description:
      'Espaço para conhecer pessoas, trocar experiências e organizar encontros com respeito e consentimento.',
    rules:
      'Respeite os limites das outras pessoas. Não publique dados pessoais de terceiros e mantenha as conversas dentro do contexto da Comunidade.',
    joinPolicy: 'approval',
    membersCanInvite: true,
    memberLimit: 100,
    tagIds: ['intent:friendship', 'intent:dating', 'audience:rj'],
  },
  canLeaveMembership: false,
};

function currentPreview(): CommunityPreviewResponse {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  return scenario === 'owner' ? ownerPreview : preview;
}

const feedPage: CommunityFeedPage = {
  generatedAt: now,
  nextCursor: null,
  items: [
    {
      postId: 'visual-community-post-1',
      kind: 'text',
      author: {
        label: 'Marina',
        avatarUrl: null,
        profileTypeLabel: 'Mulher',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
      text: 'Quem anima combinar alguma coisa tranquila no fim de semana? Podemos decidir pelo grupo.',
      image: null,
      location: null,
      replyTo: {
        postId: 'visual-community-reference-post',
        authorLabel: 'Clara',
        textPreview: 'Podemos começar por um café mais tranquilo e decidir o restante pelo grupo.',
        available: true,
      },
      metrics: { commentCount: 4, reactionCount: 13 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: false,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 5 * 60_000,
    },
    {
      postId: 'visual-community-post-2',
      kind: 'photo',
      author: {
        label: 'Rafael',
        avatarUrl: null,
        profileTypeLabel: 'Homem',
        city: 'Niterói',
        state: 'RJ',
      },
      text: 'Uma referência do lugar que comentamos ontem.',
      image: { url: visualImage, alt: 'Imagem de referência para inspeção visual' },
      location: null,
      replyTo: null,
      metrics: { commentCount: 2, reactionCount: 9 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: true,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 18 * 60_000,
    },
    {
      postId: 'visual-community-post-3',
      kind: 'location',
      author: { label: 'Bia', avatarUrl: null },
      text: 'Ponto aproximado para facilitar a chegada.',
      image: null,
      location: {
        latitude: -22.91,
        longitude: -43.18,
        precision: 'approximate',
        accuracyMeters: null,
      },
      replyTo: null,
      metrics: { commentCount: 1, reactionCount: 4 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: true,
        viewerReacted: false,
        canViewComments: true,
        canComment: true,
      },
      publishedAt: now - 31 * 60_000,
    },
  ],
};

const comments: CommunityFeedCommentPage = {
  generatedAt: now,
  nextCursor: null,
  items: [],
};

const previewRepository = {
  getPreview$: () => of(currentPreview()),
};

const membershipRepository = {
  requestMembership$: () => of({
    status: 'active',
    viewerMode: 'member',
    canInteract: true,
  }),
  leaveMembership$: () => of({
    status: 'left',
    viewerMode: 'visitor',
    canInteract: false,
  }),
  getMembershipRequests$: () => of({ items: [], generatedAt: now }),
  reviewMembership$: () => NEVER,
};

const feedRepository = {
  getPage$: ({ view }: { view: 'feed' | 'photos' }) => of({
    ...feedPage,
    items: view === 'photos'
      ? feedPage.items.filter((item) => item.kind === 'photo')
      : feedPage.items,
  }),
  getItems$: ({ postIds }: { postIds: readonly string[] }) => of({
    ...feedPage,
    items: feedPage.items.filter((item) => postIds.includes(item.postId)),
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
    reactionCount: 14,
  }),
};

const commentRepository = {
  getPage$: () => of(comments),
  getRepliesPage$: () => of(comments),
  watchCommentCount$: () => of(0),
  createComment$: () => NEVER,
  createReply$: () => NEVER,
  moderateComment$: () => NEVER,
  moderateReply$: () => NEVER,
};

const route = {
  snapshot: {
    data: { backRoute: '/dashboard/comunidades' },
    paramMap: convertToParamMap({ communityId: 'visual-community' }),
    queryParamMap: convertToParamMap({}),
  },
  paramMap: of(convertToParamMap({ communityId: 'visual-community' })),
  queryParamMap: of(convertToParamMap({})),
};

@Component({
  selector: 'app-root',
  standalone: false,
  providers: [
    { provide: ActivatedRoute, useValue: route },
    { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(false) }) } },
    { provide: CommunityPreviewRepository, useValue: previewRepository },
    { provide: CommunityMembershipRepository, useValue: membershipRepository },
    { provide: CommunityFeedRepository, useValue: feedRepository },
    { provide: CommunityFeedCommentRepository, useValue: commentRepository },
    {
      provide: ContentAccessNavigationService,
      useValue: { navigateForDecision: () => Promise.resolve(true) },
    },
    {
      provide: ErrorNotificationService,
      useValue: {
        showSuccess: () => undefined,
        showWarning: () => undefined,
        showError: () => undefined,
        showInfo: () => undefined,
      },
    },
    {
      provide: GlobalErrorHandlerService,
      useValue: { handleError: (error: unknown) => console.error(error) },
    },
    {
      provide: GeolocationService,
      useValue: {
        currentPosition$: () => of({
          latitude: -22.912345,
          longitude: -43.187654,
          accuracy: 18,
        }),
        watchPosition$: () => of({
          latitude: -22.912345,
          longitude: -43.187654,
          accuracy: 18,
        }),
      },
    },
    { provide: AuthSessionService, useValue: { currentAuthUser: { uid: 'visual-user' } } },
    {
      provide: StorageService,
      useValue: { uploadFile: () => of('community-feed/visual-image.webp') },
    },
    {
      provide: CameraCaptureService,
      useValue: { openCamera$: () => NEVER, stopStream: () => undefined },
    },
    { provide: PhotoEditorLauncherService, useValue: { open$: () => NEVER } },
  ],
  template: `<app-community-preview-page />`,
  styles: [`:host { display: block; min-height: 100vh; }`],
})
export class AppComponent {}
