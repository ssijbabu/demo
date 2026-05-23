import { jsx } from 'react/jsx-runtime';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { SignInPage } from '@backstage/core-components';
import { microsoftAuthApiRef } from '@backstage/core-plugin-api';

export const signInModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    SignInPageBlueprint.make({
      params: {
        loader: async () => props =>
          jsx(SignInPage, {
            ...props,
            providers: [
              {
                id: 'microsoft-auth-provider',
                title: 'Microsoft',
                message: 'Sign in with your Microsoft / Azure account',
                apiRef: microsoftAuthApiRef,
              },
            ],
          }),
      },
    }),
  ],
});
