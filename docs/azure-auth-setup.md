# Azure Authentication Setup

This guide covers how to configure Microsoft Entra ID (Azure AD) sign-in for this Backstage instance.

The backend uses a custom authenticator (`federatedMicrosoftAuthenticator`) that supports two credential modes:

| Mode | When `AZURE_FEDERATED_TOKEN_FILE` is set | Environment |
|---|---|---|
| **Federated credential** (workload identity) | Yes — injected by AKS | AKS production |
| **Client secret** | No — falls back automatically | Local development |

Certificate and managed identity are not supported for the OAuth2 user sign-in flow. Managed identity is a service-to-service mechanism; it cannot authenticate users via OAuth2.

---

## Prerequisites

- An Azure subscription
- Permission to create App Registrations in your tenant (Application Administrator or Global Administrator)
- The Backstage instance running locally or accessible at a known URL

---

## Step 1 — Create an App Registration

1. Open the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**.

2. Fill in the form:

   | Field | Value |
   |---|---|
   | Name | `Backstage` (or any descriptive name) |
   | Supported account types | **Accounts in this organizational directory only** |
   | Redirect URI (platform) | **Web** |
   | Redirect URI (value) | `http://localhost:7007/api/auth/microsoft/handler/frame` |

   > **Important:** the platform must be **Web**, not *Single-page application*. SPA enforces PKCE; the Backstage backend redeems the authorization code server-side without a PKCE challenge, which causes `AADSTS9002325`.

   For production, add an additional redirect URI under the same **Web** platform:
   ```
   https://<your-backstage-domain>/api/auth/microsoft/handler/frame
   ```

3. Click **Register**.

4. On the **Overview** page, copy:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`

---

## Step 2 — Add API Permissions

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.

2. Add:

   | Permission | Reason |
   |---|---|
   | `openid` | Required for sign-in |
   | `profile` | Read user's basic profile |
   | `email` | Read user's email address |
   | `offline_access` | Allows token refresh without re-prompting |
   | `User.Read` | Read the signed-in user's full profile from Graph |

3. Click **Grant admin consent for \<your tenant\>** and confirm.

---

## Step 3 — Configure Credentials

Choose the method that matches your environment.

---

### Option A — Client Secret (local development)

1. Go to **Certificates & secrets → Client secrets → New client secret**.
2. Set a description and expiry, then click **Add**.
3. Copy the **Value** immediately.

Set in your `.env` file (auto-loaded by `yarn start`):

```bash
AZURE_CLIENT_ID=<Application (client) ID>
AZURE_CLIENT_SECRET=<client secret value>
AZURE_TENANT_ID=<Directory (tenant) ID>
```

The `app-config.yaml` already reads these:

```yaml
auth:
  providers:
    microsoft:
      development:
        clientId: ${AZURE_CLIENT_ID}
        clientSecret: ${AZURE_CLIENT_SECRET}
        tenantId: ${AZURE_TENANT_ID}
```

---

### Option B — Federated Credential / AKS Workload Identity (production)

No client secret is stored anywhere. AKS injects a short-lived Kubernetes service account token that Azure AD trusts via a federated credential on the app registration.

#### 1. Enable the AKS OIDC issuer

```bash
az aks update \
  --resource-group <your-rg> \
  --name <your-cluster> \
  --enable-oidc-issuer \
  --enable-workload-identity
```

Get the issuer URL:

```bash
az aks show \
  --resource-group <your-rg> \
  --name <your-cluster> \
  --query "oidcIssuerProfile.issuerUrl" \
  -o tsv
```

#### 2. Add a federated credential on the app registration

In Azure Portal → your app registration → **Certificates & secrets → Federated credentials → Add credential**:

| Field | Value |
|---|---|
| Scenario | **Kubernetes accessing Azure resources** |
| Cluster issuer URL | The OIDC issuer URL from the step above |
| Namespace | Kubernetes namespace where Backstage runs (e.g. `backstage`) |
| Service account name | Name of the Kubernetes service account (e.g. `backstage`) |
| Name | Any label, e.g. `backstage-aks` |

Once the federated credential is configured, **delete the client secret** from the app registration.

#### 3. Create a Kubernetes service account

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: backstage
  namespace: backstage
  annotations:
    azure.workload.identity/client-id: "<AZURE_CLIENT_ID>"
    azure.workload.identity/tenant-id: "<AZURE_TENANT_ID>"
```

#### 4. Configure the Backstage pod

Add the workload identity label and service account. The webhook injects `AZURE_FEDERATED_TOKEN_FILE` automatically.

```yaml
metadata:
  labels:
    azure.workload.identity/use: "true"
spec:
  serviceAccountName: backstage
  containers:
    - name: backstage
      env:
        - name: AZURE_CLIENT_ID
          value: "<AZURE_CLIENT_ID>"
        - name: AZURE_TENANT_ID
          value: "<AZURE_TENANT_ID>"
        # Do NOT set AZURE_CLIENT_SECRET
```

#### 5. Production app-config

In `app-config.production.yaml`, omit `clientSecret`:

```yaml
auth:
  providers:
    microsoft:
      production:
        clientId: ${AZURE_CLIENT_ID}
        tenantId: ${AZURE_TENANT_ID}
```

#### How it works at runtime

1. Pod starts → AKS webhook injects `AZURE_FEDERATED_TOKEN_FILE` pointing to a projected service account token
2. User clicks **SIGN IN** → the authenticator reads the token file and sends it as `client_assertion` to Azure AD
3. Azure AD validates the assertion against the federated credential config (no secret used)
4. Azure AD issues access and refresh tokens

---

## Step 4 — User Mapping

The sign-in resolver is `emailMatchingUserEntityAnnotation` with `dangerouslyAllowSignInWithoutUserInCatalog: true`. This means:

- Users **with** a catalog `User` entity are matched by the `microsoft.com/email` annotation.
- Users **without** a catalog entity can still sign in — they get a Backstage identity derived from their email.

To require catalog entities (stricter), remove `dangerouslyAllowSignInWithoutUserInCatalog` from `microsoftAuthModule.ts` and add entities like:

```yaml
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: john.doe
  annotations:
    microsoft.com/email: john.doe@mycompany.com
spec:
  profile:
    email: john.doe@mycompany.com
    displayName: John Doe
  memberOf: [team-a]
```

---

## Step 5 — Run and Verify

1. Set the required environment variables (see Step 3).

2. Start the app:

   ```bash
   yarn start
   ```

3. Open [http://localhost:3000](http://localhost:3000). You should see the **Sign in with Microsoft** card.

4. Click **SIGN IN**. A Microsoft login popup opens. Sign in with your Entra ID account.

5. After successful sign-in you are redirected to the Backstage catalog.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `The microsoft provider is not configured` | Missing env vars | Verify `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and (for local dev) `AZURE_CLIENT_SECRET` are set |
| `AADSTS50011: Redirect URI mismatch` | Registered URI doesn't match | Add `http://localhost:7007/api/auth/microsoft/handler/frame` under **Web** platform in the app registration |
| `AADSTS9002325: Proof Key for Code Exchange is required` | Redirect URI is under **Single-page application** instead of **Web** | In Azure Portal → Authentication, delete the URI from the SPA section and re-add it under **Web** |
| `Azure AD token request failed` | Wrong or expired client secret | Rotate the client secret and update `.env` |
| `Azure AD token request failed` on AKS | Federated credential not configured or namespace/service account mismatch | Verify the federated credential Namespace and Service account name match the pod's service account |
| Sign-in succeeds but wrong user identity | Email annotation mismatch on `User` entity | Check `microsoft.com/email` annotation matches the user's UPN in Entra ID |

---

## Environment Variable Reference

| Variable | Required for | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | Both modes | Application (client) ID from the app registration |
| `AZURE_TENANT_ID` | Both modes | Directory (tenant) ID from the app registration |
| `AZURE_CLIENT_SECRET` | Option A (local dev) | Client secret — not used when `AZURE_FEDERATED_TOKEN_FILE` is present |
| `AZURE_FEDERATED_TOKEN_FILE` | Option B (AKS) | Path to the projected service account token — injected automatically by the AKS workload identity webhook |
