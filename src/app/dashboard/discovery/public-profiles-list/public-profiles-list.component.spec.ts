// src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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

    fixture.componentRef.setInput('profiles', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('errorMessage', null);

    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('mantém o estado vazio curto e sem painel duplicado', () => {
    const empty = fixture.debugElement.query(
      By.css('.public-profiles__empty')
    ).nativeElement as HTMLElement;

    expect(empty.textContent?.trim()).toBe('Nenhum perfil compatível agora.');
    expect(fixture.debugElement.query(By.css('.public-profiles__summary'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.public-profiles__end'))).toBeNull();
  });
});
