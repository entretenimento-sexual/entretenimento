import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LinksInteractionComponent } from './links-interaction.component';

describe('LinksInteractionComponent', () => {
  let component: LinksInteractionComponent;
  let fixture: ComponentFixture<LinksInteractionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LinksInteractionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LinksInteractionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
