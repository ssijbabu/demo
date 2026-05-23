# Azure Authentication Setup

This guide covers how to configure Microsoft Entra ID (formerly Azure AD) sign-in for this Backstage instance. The implementation uses `DefaultAzureCredential`-compatible environment variables, so the same credential configuration works across all environments: local development, CI/CD pipelines, and Azure-hosted deployments.

---

## Prerequisites

- An Azure subscription
- Permission to create App Registrations in your Azure tenant (Application Administrator or Global Administrator role)
- The Backstage instance running locally or accessible at a known URL

---

## Step 1 — Create an App Registration

1. Open the [Azure Portal](https://portal.azure.com) and navigate to **Microsoft Entra ID → App registrations → New registration**.

2. Fill in the form:

   | Field | Value |
   |-------|-------|
   | Name | `Backstage` (or any descriptive name) |
   | Supported account types | **Accounts in this organizational directory only** (single tenant) |
   | Redirect URI (platform) | **Web** |
   | Redirect URI (value) | `http://localhost:7007/api/auth/microsoft/handler/frame` |

   > **Important:** the platform must be **Web**, not *Single-page application*. SPA enforces PKCE; Backstage's backend redeems the authorization code server-side and does not send a PKCE challenge, which causes `AADSTS9002325`.

   For production, add an additional redirect URI under the same **Web** platform:
   ```
   https://<your-backstage-domain>/api/auth/microsoft/handler/frame
   ```

3. Click **Register**.

4. On the **Overview** page, copy:
   - **Application (client) ID** → this is `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → this is `AZURE_TENANT_ID`

---

## Step 2 — Add API Permissions

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.

2. Add the following permissions:

   | Permission | Reason |
   |------------|--------|
   | `openid` | Required for sign-in |
   | `profile` | Read user's basic profile |
   | `email` | Read user's email address (used to match Backstage user entities) |
   | `offline_access` | Allows token refresh without re-prompting |
   | `User.Read` | Read the signed-in user's full profile |

3. Click **Add permissions**, then click **Grant admin consent for \<your tenant\>** and confirm.

---

## Step 3 — Choose a Credential Method

Pick **one** of the following credential methods depending on your environment. The environment variables mirror the `DefaultAzureCredential` chain from `@azure/identity`.

---

### Option A — Client Secret (recommended for local dev and CI/CD)

1. Go to **Certificates & secrets → Client secrets → New client secret**.
2. Set a description and expiry, then click **Add**.
3. Copy the **Value** immediately (it won't be shown again).

Set environment variables:

```bash
export AZURE_CLIENT_ID=<Application (client) ID>
export AZURE_CLIENT_SECRET=<client secret value>
export AZURE_TENANT_ID=<Directory (tenant) ID>
```

In `app-config.yaml` (already configured):

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

### Option B — Client Certificate (no secrets stored in plain text)

1. Generate a self-signed certificate or obtain one from your PKI:

   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem \
     -days 365 -nodes -subj "/CN=backstage-auth"
   cat cert.pem key.pem > backstage-auth.pem
   ```

2. Upload the **public certificate** (`cert.pem`) to **Certificates & secrets → Certificates → Upload certificate**.

3. Store the combined PEM file (`backstage-auth.pem`) securely on the server (e.g., `/etc/backstage/auth.pem`).

4. In `app-config.yaml`, replace `clientSecret` with `clientCertificatePath`:

   ```yaml
   auth:
     providers:
       microsoft:
         development:
           clientId: ${AZURE_CLIENT_ID}
           tenantId: ${AZURE_TENANT_ID}
           clientCertificatePath: ${AZURE_CLIENT_CERTIFICATE_PATH}
   ```

Set environment variables:

```bash
export AZURE_CLIENT_ID=<Application (client) ID>
export AZURE_TENANT_ID=<Directory (tenant) ID>
export AZURE_CLIENT_CERTIFICATE_PATH=/etc/backstage/auth.pem
```

---

### Option C — Managed Identity (Azure-hosted deployments only)

When Backstage runs on an Azure resource that has a **system-assigned or user-assigned managed identity** (App Service, AKS, Container Apps, VM), no secrets are required.

1. Enable the managed identity on your Azure resource (e.g., App Service → **Identity → System assigned → On**).

2. Grant the managed identity access to your app registration:
   - Go to the app registration → **API permissions** and ensure `User.Read` is consented at the tenant level.
   - The managed identity does not need a client secret; Azure handles credential issuance.

3. Assign the **`Directory Readers`** role (or equivalent) to the managed identity so it can read user profiles from Microsoft Graph.

4. Set environment variables (no secret needed):

   ```bash
   export AZURE_CLIENT_ID=<Application (client) ID>
   export AZURE_TENANT_ID=<Directory (tenant) ID>
   # AZURE_CLIENT_SECRET is not set
   ```

5. In `app-config.yaml`, omit `clientSecret` and `clientCertificatePath`. Backstage will pick up the managed identity automatically via MSAL's managed identity support.

> **Note:** Managed identity for the OAuth2 user sign-in flow requires that the App Registration is linked to the managed identity principal. For backend Azure SDK calls (e.g., Azure Storage, Key Vault), `DefaultAzureCredential` from `@azure/identity` (already installed) handles managed identity automatically with no configuration.

---

### Option D — Workload Identity (AKS with OIDC issuer)

For Kubernetes deployments on AKS with [Workload Identity](https://learn.microsoft.com/azure/aks/workload-identity-overview) enabled:

1. Create a Kubernetes service account and federate it with the app registration.
2. Annotate the pod with `azure.workload.identity/client-id`.
3. The following environment variables are injected automatically by the AKS webhook:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_FEDERATED_TOKEN_FILE`

No `AZURE_CLIENT_SECRET` is needed. `DefaultAzureCredential` detects workload identity automatically.

---

## Step 4 — Map Users to Backstage Entities

The Microsoft provider is configured to resolve sign-ins using `emailMatchingUserEntityProfileEmail`. This means every user who signs in must have a matching `User` entity in the catalog with their email in the profile.

Example entity in `examples/org.yaml`:

```yaml
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: john.doe
spec:
  profile:
    email: john.doe@mycompany.com
    displayName: John Doe
  memberOf: [team-a]
```

If no matching entity is found, the sign-in will fail. To allow any authenticated Entra ID user without a catalog entity, replace the resolver in `app-config.yaml`:

```yaml
signIn:
  resolvers:
    - resolver: emailLocalPartMatchingUserEntityName
```

---

## Step 5 — Run and Verify

1. Export the required environment variables (see Step 3 for your chosen method).

2. Start the backend:

   ```bash
   yarn start
   ```

3. Open [http://localhost:3000](http://localhost:3000). You should see the **Sign in with Microsoft** button.

4. Click the button. A Microsoft login popup will open. Sign in with your Entra ID account.

5. After successful sign-in you are redirected back to the Backstage catalog.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `The microsoft provider is not configured` | Missing env vars or `app-config.yaml` not loaded | Verify all three env vars are set and the backend restarted |
| `Redirect URI mismatch` / `AADSTS50011` | The registered redirect URI doesn't match | Add `http://localhost:7007/api/auth/microsoft/handler/frame` under the **Web** platform in the app registration |
| `AADSTS9002325: Proof Key for Code Exchange is required` | Redirect URI is registered under **Single-page application** platform instead of **Web** | In Azure Portal → Authentication, delete the URI from the SPA section and re-add it under **Web**. SPA enforces PKCE; Backstage uses a server-side confidential flow that does not send a PKCE challenge. |
| Sign-in succeeds but Backstage says user not found | No matching `User` entity in the catalog | Add the user entity with the correct email, or change the sign-in resolver |
| Token acquisition fails with managed identity | Managed identity not enabled or not granted consent | Enable managed identity on the Azure resource and grant admin consent on the app registration |

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_CLIENT_ID` | Yes | Application (client) ID from the app registration |
| `AZURE_TENANT_ID` | Yes | Directory (tenant) ID from the app registration |
| `AZURE_CLIENT_SECRET` | Option A only | Client secret value |
| `AZURE_CLIENT_CERTIFICATE_PATH` | Option B only | Absolute path to the PEM file containing cert + key |
| `AZURE_FEDERATED_TOKEN_FILE` | Option D only | Injected automatically by AKS workload identity webhook |
