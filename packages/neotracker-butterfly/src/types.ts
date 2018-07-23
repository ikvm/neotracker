import execa from 'execa';
import { createCircleCI } from './circleci';
import { createGithub } from './github';

// tslint:disable-next-line no-any no-unused readonly-array
type PromiseReturnType<T> = T extends (...args: any[]) => Promise<infer R> ? R : never;

export interface Logger {
  readonly verbose: (message: string) => void;
  readonly info: (message: string) => void;
  readonly error: (message: string, error?: Error) => void;
}

export interface Butterfly {
  readonly circleci: PromiseReturnType<typeof createCircleCI>;
  readonly github: PromiseReturnType<typeof createGithub>;
  readonly log: Logger;
  readonly exec: (
    file: string,
    argsOrOptions?: ReadonlyArray<string> | execa.Options,
    options?: execa.Options,
  ) => execa.ExecaChildProcess;
  readonly tmp: {
    readonly fileName: () => Promise<string>;
  };
}

export interface PullRequest {
  readonly body: string;
}

export interface ButterflyCI extends Butterfly {
  readonly pr: PullRequest;
}

// tslint:disable-next-line no-any
export interface GithubEvent<TPayload = any> {
  readonly name: string;
  readonly payload: TPayload;
}
