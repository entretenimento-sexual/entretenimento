//src\app\explore\components\explore-section\explore-section.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';

export type TExploreSectionTone = 'default' | 'boosted';

@Component({
  selector: 'app-explore-section',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './explore-section.component.html',
  styleUrls: ['./explore-section.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreSectionComponent {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly note = input<string | null>(null);
  readonly routeCommands = input<readonly unknown[] | null>(null);
  readonly tone = input<TExploreSectionTone>('default');
}
