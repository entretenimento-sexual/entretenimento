// src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicProfilesListComponent } from './public-profiles-list.component';

describe('PublicProfilesListComponent', () => {
  let component: PublicProfilesListComponent;
  let fixture: ComponentFixture<PublicProfilesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicProfilesListComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicProfilesListComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('profiles', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('loadingMore', false);
    fixture.componentRef.setInput('hasMore', false);
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

    expect(empty.textContent).toContain('Nenhum perfil disponível agora.');
    expect(fixture.debugElement.query(By.css('.public-profiles__summary'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.public-profiles__end'))).toBeNull();
  });

  it('permite buscar outra página quando os filtros eliminam a página atual', () => {
    const loadMoreSpy = vi.fn();
    component.loadMore.subscribe(loadMoreSpy);

    fixture.componentRef.setInput(
      'emptyMessage',
      'Nenhum perfil corresponde aos filtros desta página.'
    );
    fixture.componentRef.setInput('filteredByPreferences', true);
    fixture.componentRef.setInput('hasMore', true);
    fixture.detectChanges();

    const loadMoreButton = fixture.debugElement.query(
      By.css('.public-profiles__load-more')
    );
    const reviewLink = fixture.debugElement.query(
      By.css('.public-profiles__review')
    );

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhum perfil corresponde aos filtros desta página.'
    );
    expect(reviewLink).toBeTruthy();

    loadMoreButton.triggerEventHandler('click');
    expect(loadMoreSpy).toHaveBeenCalledTimes(1);
  });
});
