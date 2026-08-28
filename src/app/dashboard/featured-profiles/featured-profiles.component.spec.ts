// src/app/dashboard/featured-profiles/featured-profiles.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { FeaturedProfilesComponent } from './featured-profiles.component';

describe('FeaturedProfilesComponent', () => {
  let component: FeaturedProfilesComponent;
  let fixture: ComponentFixture<FeaturedProfilesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FeaturedProfilesComponent], // ⬅ não-standalone → declarations
      imports: [CommonModule, RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(FeaturedProfilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
