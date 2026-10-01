// src/app/preferences/pages/compatibility-lab/compatibility-lab.component.ts
// Página laboratório de compatibilidade.
// Agora alinhada ao padrão visual interno do domínio preferences,
// sem criar shell paralelo ao shell global.
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';

import { CompatibilityPreviewFacade } from '../../application/compatibility-preview.facade';
import { CompatibilityPreviewCardComponent } from '../../components/compatibility-preview-card/compatibility-preview-card.component';
import { MatchProfilePreviewCardComponent } from '../../components/match-profile-preview-card/match-profile-preview-card.component';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-compatibility-lab',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CompatibilityPreviewCardComponent,
    MatchProfilePreviewCardComponent,
    PageHeaderComponent,
  ],
  templateUrl: './compatibility-lab.component.html',
  styleUrl: './compatibility-lab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompatibilityLabComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly compatibilityFacade = inject(CompatibilityPreviewFacade);
  private readonly preferencesUi = inject(PreferencesUiService);

  readonly targetUid$ = this.route.paramMap.pipe(
    map((params) => (params.get('targetUid') ?? '').trim() || null),
    distinctUntilChanged(),
    tap((targetUid) => {
      this.preferencesUi.setActiveView('compatibility_lab');
      this.preferencesUi.setLastCompatibilityTargetUid(targetUid);
    })
  );

  readonly vm$ = this.targetUid$.pipe(
    switchMap((targetUid) => {
      if (!targetUid) {
        return this.compatibilityFacade.getCompatibilityPreviewByTargetUid$('__invalid__');
      }

      return this.compatibilityFacade.getCompatibilityPreviewByTargetUid$(targetUid);
    })
  );
}