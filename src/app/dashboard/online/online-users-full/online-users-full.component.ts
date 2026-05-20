// src/app/dashboard/online/online-users-full/online-users-full.component.ts
// -----------------------------------------------------------------------------
// OnlineUsersFullComponent
// -----------------------------------------------------------------------------
//
// Wrapper leve da experiência de perfis online.
//
// Não controla:
// - barra de modos;
// - localização;
// - raio;
// - count$.
//
// Ele apenas repassa o modo ativo para o OnlineUsersComponent.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  DEFAULT_DISCOVERY_MODE,
  DiscoveryMode,
  normalizeDiscoveryMode,
} from '../../discovery/models/discovery-mode.model';

import { OnlineUsersComponent } from '../online-users/online-users.component';

@Component({
  selector: 'app-online-users-full',
  standalone: true,
  imports: [CommonModule, OnlineUsersComponent],
  templateUrl: './online-users-full.component.html',
  styleUrls: ['./online-users-full.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnlineUsersFullComponent {
  @Input() embedded = false;

  private _mode: DiscoveryMode = DEFAULT_DISCOVERY_MODE;

  @Input()
  set mode(value: DiscoveryMode | null | undefined) {
    this._mode = normalizeDiscoveryMode(value);
  }

  get mode(): DiscoveryMode {
    return this._mode;
  }
}