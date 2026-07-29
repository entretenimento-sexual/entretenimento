import { Component } from '@angular/core';

import {
  PLATFORM_LEGAL_MANIFEST,
} from '../../../core/services/compliance/platform-legal.constants';

@Component({
  selector: 'app-politica-de-privacidade',
  imports: [],
  templateUrl: './politica-de-privacidade.component.html',
  styleUrl: './politica-de-privacidade.component.css',
})
export class PoliticaDePrivacidadeComponent {
  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;
}
