import { fromPromise } from 'xstate';

import type { LoadedClerkWithEnv } from './sign-in.types';
import { waitForLoaded } from './utils/wait-for-loaded';

export const waitForClerk = fromPromise<void, LoadedClerkWithEnv>(({ input: clerk }) =>
  waitForLoaded(() => clerk.loaded),
);

export const waitForClerkEnvironment = fromPromise<void, LoadedClerkWithEnv>(({ input: clerk }) =>
  waitForLoaded(() => Boolean(clerk.__unstable__environment)),
);
