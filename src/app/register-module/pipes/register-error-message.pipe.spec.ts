import { TestBed } from '@angular/core/testing';
import { RegisterErrorMessagePipe } from './register-error-message.pipe';

describe('RegisterErrorMessagePipe', () => {
  let pipe: RegisterErrorMessagePipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RegisterErrorMessagePipe] });
    pipe = TestBed.inject(RegisterErrorMessagePipe);
  });

  it('can load instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('transforms X to Y', () => {
    const value: any = 'X';
    const args: string[] = [];
    expect(pipe.transform(value, args)).toEqual('Y');
  });
});
