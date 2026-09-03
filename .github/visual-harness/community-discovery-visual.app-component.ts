import { Component } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, NEVER, of } from 'rxjs';

import { AuthSessionService } from './core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from './core/services/error-handler/application-error.service';
import { ProfilePreferencesService } from './preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from './community/community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from './community/data-access/community-membership.repository';
import { CommunityPreviewRepository } from './community/data-access/community-preview.repository';
import type { CommunityPreviewCard } from './community/data-access/community-preview.model';
import { CommunityTagRepository } from './community/data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community/discovery/community-discovery-cache.service';
import { CommunityDiscoveryExposureService } from './community/discovery/community-discovery-exposure.service';
import { CommunityDiscoverySessionBehaviorService } from './community/discovery/community-discovery-session-behavior.service';

const now = Date.now();
const visualState = new URLSearchParams(window.location.search).get('visualState') ?? 'explore';
const visualSourceType = visualState === 'venues' ? 'venue' : 'community';

const tags = [
  { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
  { id: 'intent:casual', label: 'Casual', category: 'intent' },
  { id: 'intent:dating', label: 'Encontros', category: 'intent' },
  { id: 'intent:swing', label: 'Swing', category: 'intent' },
  { id: 'practice:bdsm', label: 'BDSM', category: 'practice' },
  { id: 'practice:fetishes', label: 'Fetiches', category: 'practice' },
  { id: 'audience:rj', label: 'Rio de Janeiro', category: 'audience' },
  { id: 'audience:couples', label: 'Casais', category: 'audience' },
] as const;

const communityCards: readonly CommunityPreviewCard[] = [
  {
    communityId: 'visual-community-rio',
    name: 'Encontros & Conexões RJ',
    slug: 'encontros-conexoes-rj',
    description: 'Pessoas do Rio para conversar, criar vínculos e combinar encontros com respeito.',
    source: { type: 'community', id: 'visual-community-rio' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 864, postCount: 124, mediaCount: 48 },
    access: { join: 'approval', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[0], tags[2], tags[6]],
    officialAssociation: {
      target: { type: 'event', id: 'visual-event-rio' },
      verified: true,
    },
  },
  {
    communityId: 'visual-community-swing',
    name: 'Casais & Swing Brasil',
    slug: 'casais-swing-brasil',
    description: 'Comunidade para casais trocarem experiências e descobrirem eventos e afinidades.',
    source: { type: 'community', id: 'visual-community-swing' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1320, postCount: 286, mediaCount: 91 },
    access: { join: 'approval', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[3], tags[7]],
    officialAssociation: {
      target: { type: 'organization', id: 'visual-org-swing' },
      verified: true,
    },
  },
  {
    communityId: 'visual-community-fetiches',
    name: 'Fetiches sem Pressa',
    slug: 'fetiches-sem-pressa',
    description: 'Conversas sobre fetiches, limites, consentimento e experiências em um espaço moderado.',
    source: { type: 'community', id: 'visual-community-fetiches' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 418, postCount: 73, mediaCount: 26 },
    access: { join: 'open', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[5], tags[4]],
  },
  {
    communityId: 'visual-community-profile',
    name: 'Agenda da Marina',
    slug: 'agenda-da-marina',
    description: 'Comunidade oficial para acompanhar encontros, novidades e eventos publicados pelo perfil.',
    source: { type: 'community', id: 'visual-community-profile' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 206, postCount: 38, mediaCount: 17 },
    access: { join: 'open', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[2], tags[6]],
    officialAssociation: {
      target: { type: 'profile', id: 'visual-profile-marina' },
      verified: true,
    },
  },
  {
    communityId: 'visual-community-bdsm',
    name: 'BDSM com Segurança e Consentimento',
    slug: 'bdsm-com-seguranca-consentimento',
    description: 'Troca de conhecimento, boas práticas e conversas responsáveis sobre BDSM.',
    source: { type: 'community', id: 'visual-community-bdsm' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 583, postCount: 112, mediaCount: 35 },
    access: { join: 'approval', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[4], tags[5]],
  },
  {
    communityId: 'visual-community-amizade',
    name: 'Amizades e Boa Companhia',
    slug: 'amizades-boa-companhia',
    description: 'Para quem quer conhecer gente nova e manter conversas leves sem pressão.',
    source: { type: 'community', id: 'visual-community-amizade' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 341, postCount: 54, mediaCount: 19 },
    access: { join: 'open', minimumRole: null, requiresActiveSubscription: false },
    tags: [tags[0], tags[6]],
  },
];

const venueCards: readonly CommunityPreviewCard[] = [
  {
    communityId: 'visual-venue-copacabana',
    name: 'Club Atlântico',
    slug: 'club-atlantico',
    description: 'Espaço verificado com agenda própria e comunidade vinculada.',
    source: { type: 'venue', id: 'visual-venue-copacabana' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 704, postCount: 86, mediaCount: 42 },
    access: { join: 'open', minimumRole: null, requiresActiveSubscription: false },
    tags: [],
    publicLocation: { district: 'copacabana', city: 'rio de janeiro', uf: 'RJ' },
    officialAssociation: {
      target: { type: 'venue', id: 'visual-venue-copacabana' },
      verified: true,
    },
  },
  {
    communityId: 'visual-venue-barra',
    name: 'Espaço Horizonte Barra',
    slug: 'espaco-horizonte-barra',
    description: 'Local com programação recorrente e acesso mediante regras próprias.',
    source: { type: 'venue', id: 'visual-venue-barra' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 391, postCount: 57, mediaCount: 31 },
    access: { join: 'approval', minimumRole: null, requiresActiveSubscription: false },
    tags: [],
    publicLocation: { district: 'barra da tijuca', city: 'rio de janeiro', uf: 'RJ' },
    officialAssociation: {
      target: { type: 'venue', id: 'visual-venue-barra' },
      verified: true,
    },
  },
  {
    communityId: 'visual-venue-niteroi',
    name: 'Casa Orla Niterói',
    slug: 'casa-orla-niteroi',
    description: 'Espaço social com agenda, comunidade e localização pública aproximada.',
    source: { type: 'venue', id: 'visual-venue-niteroi' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 228, postCount: 34, mediaCount: 18 },
    access: { join: 'open', minimumRole: null, requiresActiveSubscription: false },
    tags: [],
    publicLocation: { district: 'icarai', city: 'niteroi', uf: 'RJ' },
    officialAssociation: {
      target: { type: 'venue', id: 'visual-venue-niteroi' },
      verified: true,
    },
  },
];

const profileCards: readonly CommunityPreviewCard[] = [
  communityCards[3],
  communityCards[0],
  venueCards[0],
];

const route = {
  snapshot: {
    data: {
      sourceType: visualSourceType,
      discoveryMode: 'explore',
    },
    paramMap: convertToParamMap({}),
    queryParamMap: convertToParamMap({}),
  },
  paramMap: of(convertToParamMap({})),
  queryParamMap: of(convertToParamMap({})),
};

const sessionState$ = new BehaviorSubject({
  hiddenCommunityIds: [] as readonly string[],
  signals: {} as Readonly<Record<string, {
    meaningfulOpenCount: number;
    lastMeaningfulOpenAt: number | null;
    memberActive: boolean;
  }>>,
});

const previewRepository = {
  getDiscoveryPage$: () => of({
    items: visualSourceType === 'venue' ? venueCards : communityCards,
    nextCursor: null,
    generatedAt: now,
  }),
  getMyCommunitiesPage$: () => of({ items: communityCards, nextCursor: null, generatedAt: now }),
  getProfileOfficialCommunities$: () => of({ items: profileCards, nextCursor: null, generatedAt: now }),
};

const membershipRepository = {
  getMembershipContext$: () => of({ activeCommunityIds: ['visual-community-rio'] }),
};

const tagRepository = {
  getCommunityTagCatalog$: () => of({ items: tags, generatedAt: now }),
};

const discoveryCache = {
  readSnapshot$: () => of(null),
  rememberPage: () => undefined,
};

const sessionBehavior = {
  state$: sessionState$.asObservable(),
  hideCommunity: (communityId: string) => {
    const state = sessionState$.value;
    if (state.hiddenCommunityIds.includes(communityId)) return;
    sessionState$.next({ ...state, hiddenCommunityIds: [...state.hiddenCommunityIds, communityId] });
  },
  restoreCommunity: (communityId: string) => {
    const state = sessionState$.value;
    sessionState$.next({
      ...state,
      hiddenCommunityIds: state.hiddenCommunityIds.filter((id) => id !== communityId),
    });
  },
  setMembershipActive: (communityId: string, memberActive: boolean) => {
    const state = sessionState$.value;
    const current = state.signals[communityId] ?? {
      meaningfulOpenCount: 0,
      lastMeaningfulOpenAt: null,
      memberActive: false,
    };
    sessionState$.next({
      ...state,
      signals: {
        ...state.signals,
        [communityId]: { ...current, memberActive },
      },
    });
  },
};

@Component({
  selector: 'app-root',
  standalone: false,
  providers: [
    { provide: ActivatedRoute, useValue: route },
    { provide: CommunityPreviewRepository, useValue: previewRepository },
    { provide: CommunityMembershipRepository, useValue: membershipRepository },
    { provide: CommunityTagRepository, useValue: tagRepository },
    { provide: CommunityDiscoveryCacheService, useValue: discoveryCache },
    { provide: CommunityDiscoveryExposureService, useValue: { recordQualifiedExposure: () => undefined } },
    { provide: CommunityDiscoverySessionBehaviorService, useValue: sessionBehavior },
    { provide: CommunityCreationGateService, useValue: { requestCreation$: () => NEVER } },
    { provide: AuthSessionService, useValue: { uid$: of('visual-user') } },
    { provide: ProfilePreferencesService, useValue: { getProfile$: () => of(null) } },
    {
      provide: ApplicationErrorService,
      useValue: {
        normalize: () => ({ code: 'unknown' }),
        report: (error: unknown) => console.error(error),
      },
    },
  ],
  template: `
    @if (visualState === 'profile') {
      <main class="visual-profile" aria-label="Perfil público de demonstração">
        <section class="visual-profile__summary" aria-labelledby="visual-profile-title">
          <span class="visual-profile__avatar" aria-hidden="true">MA</span>
          <div>
            <p class="visual-profile__eyebrow">Perfil público</p>
            <h1 id="visual-profile-title">Marina Alves</h1>
            <p>Rio de Janeiro/RJ · Perfil verificado para inspeção visual.</p>
          </div>
        </section>
        <app-profile-official-communities profileId="visual-profile-marina" />
      </main>
    } @else {
      <app-community-discovery-page />
    }
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .visual-profile {
      width: min(100%, 48rem);
      box-sizing: border-box;
      display: grid;
      gap: 1rem;
      margin-inline: auto;
      padding: clamp(0.75rem, 2vw, 1.25rem);
    }
    .visual-profile__summary {
      display: grid;
      grid-template-columns: 4rem minmax(0, 1fr);
      gap: 0.85rem;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid var(--surface-border, rgba(127, 127, 127, 0.22));
    }
    .visual-profile__avatar {
      display: grid;
      place-items: center;
      width: 4rem;
      height: 4rem;
      border-radius: 50%;
      background: color-mix(in oklab, var(--primary-color) 14%, var(--surface-color));
      font-weight: 800;
    }
    .visual-profile__eyebrow,
    .visual-profile__summary p,
    .visual-profile__summary h1 { margin: 0; }
    .visual-profile__eyebrow { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; opacity: 0.7; }
    .visual-profile__summary h1 { font-size: clamp(1.25rem, 4vw, 1.7rem); }
    .visual-profile__summary div { display: grid; gap: 0.2rem; min-width: 0; }
    .visual-profile__summary div > p:last-child { font-size: 0.82rem; opacity: 0.72; }
    @media (max-width: 28rem) {
      .visual-profile__summary { grid-template-columns: 3.25rem minmax(0, 1fr); padding-inline: 0.65rem; }
      .visual-profile__avatar { width: 3.25rem; height: 3.25rem; }
    }
  `],
})
export class AppComponent {
  readonly visualState = visualState;
}
