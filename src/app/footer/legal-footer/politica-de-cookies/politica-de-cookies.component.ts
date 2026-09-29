import { Component } from '@angular/core';

import {
  PLATFORM_LEGAL_MANIFEST,
} from '../../../core/services/compliance/platform-legal.constants';

@Component({
  selector: 'app-politica-de-cookies',
  imports: [],
  templateUrl: './politica-de-cookies.component.html',
  styleUrl: './politica-de-cookies.component.css',
})
export class PoliticaDeCookiesComponent {
  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;
}
