import { TestBed } from '@angular/core/testing';
import { RegisterModule } from './register.module';

describe('RegisterModule', () => {
  let pipe: RegisterModule;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RegisterModule] });
    pipe = TestBed.inject(RegisterModule);
  });

  it('can load instance', () => {
    expect(pipe).toBeTruthy();
  });
});
