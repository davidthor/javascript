import { type ClerkAPIResponseError, isClerkAPIResponseError } from '@clerk/shared/error';
import type { OAuthStrategy, SignInResource, Web3Strategy } from '@clerk/types';
import type { DoneActorEvent, DoneStateEvent, ErrorActorEvent } from 'xstate';
import { assertEvent, assign, log, setup } from 'xstate';

import { type EnabledThirdPartyProviders, getEnabledThirdPartyProviders } from '../../utils/third-party-strategies';
import type { ClerkHostRouter } from '../router';
import { waitForClerk, waitForClerkEnvironment } from './shared.actors';
import * as signInActors from './sign-in.actors';
import type { FieldDetails, LoadedClerkWithEnv } from './sign-in.types';
import { assertActorEventDone, assertActorEventError } from './utils/assert';

export interface SignInMachineContext {
  clerk: LoadedClerkWithEnv;
  enabledThirdPartyProviders?: EnabledThirdPartyProviders;
  error?: Error | ClerkAPIResponseError;
  fields: Map<string, FieldDetails>;
  resource?: SignInResource;
  router: ClerkHostRouter;
}

export interface SignInMachineInput {
  clerk: LoadedClerkWithEnv;
  router: ClerkHostRouter;
}

export type SignInMachineEvents =
  | DoneActorEvent
  | ErrorActorEvent
  | DoneStateEvent
  | { type: 'AUTHENTICATE.OAUTH'; strategy: OAuthStrategy }
  | { type: 'AUTHENTICATE.WEB3'; strategy: Web3Strategy }
  | { type: 'FIELD.ADD'; field: Pick<FieldDetails, 'type' | 'value'> }
  | { type: 'FIELD.REMOVE'; field: Pick<FieldDetails, 'type'> }
  | {
      type: 'FIELD.UPDATE';
      field: Pick<FieldDetails, 'type' | 'value'>;
    }
  | {
      type: 'FIELD.ERROR';
      field: Pick<FieldDetails, 'type' | 'error'>;
    }
  | { type: 'NEXT' }
  | { type: 'OAUTH.CALLBACK' }
  | { type: 'RETRY' }
  | { type: 'START' }
  | { type: 'SUBMIT' };

export const SignInMachine = setup({
  actors: {
    ...signInActors,
    waitForClerk,
    waitForClerkEnvironment,
  },
  actions: {
    assignResourceToContext: assign({
      resource: ({ event }) => {
        assertActorEventDone<SignInResource>(event);
        return event.output;
      },
    }),

    assignErrorMessageToContext: assign({
      error: ({ event }) => {
        assertActorEventError(event);
        return event.error;
      },
    }),

    assignThirdPartyProvidersToContext: assign({
      enabledThirdPartyProviders: ({ context }) => getEnabledThirdPartyProviders(context.clerk.__unstable__environment),
    }),

    setActive: ({ context }) => {
      const beforeEmit = () => context.router.push(context.clerk.buildAfterSignInUrl());
      void context.clerk.setActive({ session: context.resource?.createdSessionId, beforeEmit });
    },

    navigateTo: ({ context }, { path }: { path: string }) => context.router.replace(path),

    clearFields: assign({
      fields: new Map(),
    }),
  },
  guards: {
    hasClerkAPIError: ({ context }) => isClerkAPIResponseError(context.error),
    hasClerkAPIErrorCode: ({ context }, params?: { code?: string }) =>
      params?.code
        ? isClerkAPIResponseError(context.error)
          ? Boolean(context.error.errors.find(e => e.code === params.code))
          : false
        : false,
  },
  types: {
    context: {} as SignInMachineContext,
    input: {} as SignInMachineInput,
    events: {} as SignInMachineEvents,
  },
}).createMachine({
  id: 'SignIn',
  entry: log('SignIn'),
  context: ({ input }) => ({
    clerk: input.clerk,
    router: input.router,
    currentFactor: null,
    fields: new Map(),
  }),
  on: {
    'FIELD.ADD': {
      actions: assign({
        fields: ({ context, event }) => {
          if (!event.field.type) throw new Error('Field type is required');

          context.fields.set(event.field.type, event.field);
          return context.fields;
        },
      }),
    },
    'FIELD.UPDATE': {
      actions: assign({
        fields: ({ context, event }) => {
          if (!event.field.type) throw new Error('Field type is required');

          if (context.fields.has(event.field.type)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            context.fields.get(event.field.type)!.value = event.field.value;
          }

          return context.fields;
        },
      }),
    },
    'FIELD.REMOVE': {
      actions: assign({
        fields: ({ context, event }) => {
          if (!event.field.type) throw new Error('Field type is required');

          context.fields.delete(event.field.type);
          return context.fields;
        },
      }),
    },
    'FIELD.ERROR': {
      actions: assign({
        fields: ({ context, event }) => {
          if (!event.field.type) throw new Error('Field type is required');

          if (context.fields.has(event.field.type)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            context.fields.get(event.field.type)!.error = event.field.error;
          }

          return context.fields;
        },
      }),
    },
    'OAUTH.CALLBACK': '.SSOCallbackRunning',
  },
  initial: 'Init',
  states: {
    Init: {
      // We can use `fromTransition` here to send align where we need to be in the flow upon initialization
      entry: log('Init'),
      description:
        'Intialize the Clerk instance and wait for it to be ready. Also fetch the enabled third party providers.',
      invoke: {
        src: 'waitForClerk',
        input: ({ context }) => context.clerk,
        onDone: 'Start',
      },
    },
    Start: {
      id: 'Start',
      description: 'The first step in the sign in flow.',
      initial: 'Preparing',
      entry: log('Start'),
      states: {
        Preparing: {
          entry: log('Preparing'),
          invoke: {
            src: 'waitForClerkEnvironment',
            input: ({ context }) => context.clerk,
            onDone: {
              target: 'Idle',
              actions: 'assignThirdPartyProvidersToContext',
            },
            onError: {
              target: 'Failure',
              actions: log('Clerk environment failed to load.'),
            },
          },
        },
        Idle: {
          on: {
            'AUTHENTICATE.OAUTH': '#SignIn.InitiatingOAuthAuthentication',
            // 'AUTHENTICATE.WEB3': '#SignIn.InitiatingWeb3Authentication',
            SUBMIT: 'Attempting',
          },
        },
        Attempting: {
          invoke: {
            src: 'createSignIn',
            input: ({ context }) => ({
              client: context.clerk.client,
              fields: context.fields,
            }),
            onDone: { actions: 'assignResourceToContext' },
            onError: {
              actions: 'assignErrorMessageToContext',
              target: 'Failure',
            },
          },
          always: [
            {
              guard: ({ context }) => context?.resource?.status === 'complete',
              target: '#SignIn.Complete',
            },
            {
              guard: ({ context }) => context?.resource?.status === 'needs_first_factor',
              target: '#FirstFactor.Preparing',
            },
          ],
        },
        Failure: {
          always: [
            {
              guard: { type: 'hasClerkAPIErrorCode', params: { code: 'session_exists' } },
              actions: [
                {
                  type: 'navigateTo',
                  params: {
                    path: '/',
                  },
                },
              ],
            },
            {
              guard: 'hasClerkAPIError',
              actions: 'assignErrorMessageToContext',
              target: 'Idle',
            },
          ],
        },
      },
    },
    FirstFactor: {
      id: 'FirstFactor',
      initial: 'Preparing',
      description: 'Handles any-and-all steps in the first factor flow. [Optional]',
      states: {
        Preparing: {
          invoke: {
            id: 'prepareFirstFactor',
            src: 'prepareFirstFactor',
            // @ts-expect-error - TODO: Implement
            input: ({ context }) => ({
              client: context.clerk.client,
              params: {},
            }),
            onDone: {
              actions: [
                'assignResourceToContext',
                {
                  type: 'navigateTo',
                  params: {
                    path: '/sign-in/factor-two',
                  },
                },
              ],
            },
            onError: {
              actions: 'assignErrorMessageToContext',
              target: '#Start',
            },
          },
        },
        Idle: {
          on: {
            SUBMIT: {
              // guard: ({ context }) => !!context.resource,
              target: 'Attempting',
            },
          },
        },
        Attempting: {
          invoke: {
            id: 'attemptFirstFactor',
            src: 'attemptFirstFactor',
            // @ts-expect-error - TODO: Implement
            input: ({ context }) => ({
              client: context.clerk.client,
              params: {},
            }),
            onDone: {
              actions: 'assignResourceToContext',
              target: 'Success',
            },
            onError: {
              target: 'Idle',
              actions: 'assignErrorMessageToContext',
            },
          },
        },
        Success: {
          type: 'final',
          entry: {
            type: 'navigateTo',
            params: {
              path: '/sign-in/factor-two',
            },
          },
        },
        Failure: {
          always: [
            {
              guard: 'hasClerkAPIError',
              target: 'Idle',
            },
          ],
        },
      },
    },
    SecondFactor: {
      id: 'SecondFactor',
      initial: 'Preparing',
      description: 'Handles any-and-all steps in the second factor flow. [Optional]',
      states: {
        Preparing: {
          invoke: {
            id: 'prepareSecondFactor',
            src: 'prepareSecondFactor',
            // @ts-expect-error - TODO: Implement
            input: ({ context }) => ({
              client: context.clerk.client,
              params: {},
            }),
            onDone: {
              target: 'Idle',
              actions: 'assignResourceToContext',
            },
            onError: {
              target: 'Idle',
              actions: 'assignErrorMessageToContext',
            },
          },
        },
        Idle: {
          on: {
            RETRY: 'Preparing',
            SUBMIT: {
              // guard: ({ context }) => !!context.resource,
              target: 'Attempting',
            },
          },
        },
        Attempting: {
          invoke: {
            id: 'attemptFirstFactor',
            src: 'attemptFirstFactor',
            // @ts-expect-error - TODO: Implement
            input: ({ context }) => ({
              client: context.clerk.client,
              params: {},
            }),
            onDone: 'Success',
            onError: {
              actions: 'assignErrorMessageToContext',
              target: 'Idle',
            },
          },
        },
        Success: {
          type: 'final',
          entry: {
            type: 'navigateTo',
            params: {
              path: '/sign-in/factor-two', // TODO: Implement
            },
          },
        },
        Failure: {
          always: [
            {
              guard: 'hasClerkAPIError',
              target: 'Idle',
            },
            { target: 'Idle' },
          ],
        },
      },
    },
    SSOCallbackRunning: {
      invoke: {
        src: 'handleSSOCallback',
        input: ({ context }) => ({
          clerk: context.clerk,
          params: {
            firstFactorUrl: '../factor-one',
            secondFactorUrl: '../factor-two',
          },
          router: context.router,
        }),
        onDone: { actions: 'assignResourceToContext' },
        onError: {
          actions: 'assignErrorMessageToContext',
          target: 'Start.Failure',
        },
      },
      always: [
        {
          guard: ({ context }) => context?.resource?.status === 'complete',
          target: 'Complete',
        },
        {
          guard: ({ context }) => context?.resource?.status === 'needs_first_factor',
          target: 'FirstFactor',
        },
      ],
    },
    InitiatingOAuthAuthentication: {
      invoke: {
        src: 'authenticateWithRedirect',
        input: ({ context, event }) => {
          assertEvent(event, 'AUTHENTICATE.OAUTH');

          return {
            clerk: context.clerk,
            strategy: event.strategy,
          };
        },
        onError: {
          target: '#Start.Failure',
          actions: 'assignErrorMessageToContext',
        },
      },
    },
    // [STATES.InitiatingWeb3Authentication]: {
    //   invoke: {
    //     src: 'authenticateWithMetamask',
    //     onError: {
    //       target: STATES.StartFailure,
    //       actions: 'assignErrorMessageToContext',
    //     },
    //   },
    // },
    Complete: {
      type: 'final',
      entry: 'setActive',
    },
  },
});
