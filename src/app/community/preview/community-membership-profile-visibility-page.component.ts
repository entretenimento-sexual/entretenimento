import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CommunityMembershipProfileVisibilityComponent } from './community-membership-profile-visibility.component';

@Component({
  selector: 'app-community-membership-profile-visibility-page',
  standalone: true,
  imports: [RouterLink, CommunityMembershipProfileVisibilityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="membership-visibility-page">
      <a
        class="membership-visibility-page__back"
        [routerLink]="['/dashboard/comunidades', communityId]"
        [queryParams]="{ secao: 'sobre' }"
      >
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        Voltar para a Comunidade
      </a>

      <header>
        <span>Controle do membro</span>
        <h1>Privacidade da participação</h1>
        <p>
          Participações são privadas por padrão. Somente uma autorização explícita
          para esta Comunidade permite que ela apareça no seu perfil público.
        </p>
      </header>

      <app-community-membership-profile-visibility
        [communityId]="communityId"
      />
    </main>
  `,
  styles: [`
    :host { display: block; }
    .membership-visibility-page { display: grid; gap: 1rem; width: min(100%, 48rem); margin: 0 auto; padding: 1rem; }
    .membership-visibility-page__back { display: inline-flex; align-items: center; gap: .5rem; width: fit-content; min-height: 2.75rem; color: inherit; text-decoration: none; }
    header { display: grid; gap: .35rem; }
    header span { font-size: .78rem; font-weight: 700; text-transform: uppercase; opacity: .7; }
    h1, p { margin: 0; }
    p { line-height: 1.5; opacity: .82; }
    @media (max-width: 560px) { .membership-visibility-page { padding: .8rem; } }
  `],
})
export class CommunityMembershipProfileVisibilityPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly communityId = String(
    this.route.snapshot.paramMap.get('communityId') ?? ''
  ).trim();
}
