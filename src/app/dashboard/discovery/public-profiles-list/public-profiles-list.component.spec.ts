// src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PublicProfilesListComponent } from './public-profiles-list.component';

describe('PublicProfilesListComponent', () => {
  let component: PublicProfilesListComponent;
  let fixture: ComponentFixture<PublicProfilesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicProfilesListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicProfilesListComponent);
    component = fixture.componentInstance;

    /**
     * Mantém o teste compatível com @Input clássico e signal input.
     * Se o componente usar input.required(), isso evita erro no detectChanges().
     */
    fixture.componentRef.setInput('profiles', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('errorMessage', null);

    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });
});