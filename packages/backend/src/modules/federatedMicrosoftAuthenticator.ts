import {
  createOAuthAuthenticator,
  PassportOAuthAuthenticatorHelper,
  type PassportProfile,
} from '@backstage/plugin-auth-node';
import { readFileSync } from 'fs';

// Credential params injected into every token endpoint POST body.
// On AKS with workload identity, AZURE_FEDERATED_TOKEN_FILE is injected by the
// mutating webhook; the file contains a Kubernetes service-account JWT that
// Azure AD trusts via the federated credential configuration on the app
// registration (no client secret needed at all).
// In local dev the file is absent, so we fall back to clientSecret.
function getClientCredential(
  config: { getString: (k: string) => string; getOptionalString: (k: string) => string | undefined },
): Record<string, string> {
  const tokenFile = process.env.AZURE_FEDERATED_TOKEN_FILE;
  if (tokenFile) {
    return {
      client_assertion_type:
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: readFileSync(tokenFile, 'utf8').trim(),
    };
  }
  return { client_secret: config.getString('clientSecret') };
}

async function fetchGraphProfile(accessToken: string): Promise<PassportProfile> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `Microsoft Graph /me request failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = await res.json();
  return {
    id: json.id,
    displayName: json.displayName ?? json.mail ?? json.userPrincipalName,
    username: json.mail ?? json.userPrincipalName,
    provider: 'microsoft',
    emails: [{ value: json.mail ?? json.userPrincipalName }],
  };
}

async function postToTokenEndpoint(
  tenantId: string,
  body: Record<string, string>,
): Promise<{
  access_token: string;
  token_type: string;
  id_token?: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure AD token request failed: ${text}`);
  }
  return res.json();
}

export const federatedMicrosoftAuthenticator = createOAuthAuthenticator({
  defaultProfileTransform:
    PassportOAuthAuthenticatorHelper.defaultProfileTransform,

  scopes: {
    required: ['email', 'openid', 'offline_access', 'user.read'],
    transform({ requested, granted, required, additional }) {
      const hasResourceScope = Array.from(requested).some(s => s.includes('/'));
      if (hasResourceScope) return [...requested, 'offline_access'];
      return [...requested, ...granted, ...required, ...additional];
    },
  },

  initialize({ callbackUrl, config }) {
    const clientId = config.getString('clientId');
    const tenantId = config.getString('tenantId');
    return { clientId, tenantId, callbackUrl, config };
  },

  async start(input, ctx) {
    const { clientId, tenantId, callbackUrl } = ctx;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: callbackUrl,
      scope: input.scope,
      state: input.state,
      response_mode: 'query',
    });
    return {
      url: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`,
    };
  },

  async authenticate(input, ctx) {
    const { clientId, tenantId, callbackUrl, config } = ctx;
    const req = input.req as any;
    const code = req.query?.code as string | undefined;
    if (!code) throw new Error('No authorization code received in callback');

    const tokens = await postToTokenEndpoint(tenantId, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: clientId,
      scope: 'email openid offline_access user.read',
      ...getClientCredential(config),
    });

    const fullProfile = await fetchGraphProfile(tokens.access_token);
    return {
      fullProfile,
      session: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type ?? 'bearer',
        idToken: tokens.id_token,
        scope: tokens.scope,
        expiresInSeconds: tokens.expires_in,
        refreshToken: tokens.refresh_token,
      },
    };
  },

  async refresh(input, ctx) {
    const { clientId, tenantId, config } = ctx;

    const tokens = await postToTokenEndpoint(tenantId, {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: clientId,
      scope: input.scope,
      ...getClientCredential(config),
    });

    const fullProfile = await fetchGraphProfile(tokens.access_token);
    return {
      fullProfile,
      session: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type ?? 'bearer',
        idToken: tokens.id_token,
        scope: tokens.scope,
        expiresInSeconds: tokens.expires_in,
        refreshToken: tokens.refresh_token ?? input.refreshToken,
      },
    };
  },
});
