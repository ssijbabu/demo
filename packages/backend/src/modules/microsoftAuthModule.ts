import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  microsoftAuthenticator,
  microsoftSignInResolvers,
} from '@backstage/plugin-auth-backend-module-microsoft-provider';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';

export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'microsoft-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'microsoft',
          factory: createOAuthProviderFactory({
            authenticator: microsoftAuthenticator,
            signInResolver:
              microsoftSignInResolvers.emailMatchingUserEntityAnnotation({
                dangerouslyAllowSignInWithoutUserInCatalog: true,
              }),
          }),
        });
      },
    });
  },
});
