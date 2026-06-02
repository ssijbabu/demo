# Build and Deploy

This document covers how to build and deploy the Backstage developer portal in all environments.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 22 or 24 | Local development |
| Yarn | 4.x (bundled) | Package manager |
| Docker | 24+ | Container builds |
| Docker Compose | v2 | Local container testing |
| Azure CLI | latest | AKS and Azure operations |
| kubectl | latest | Kubernetes deployments |

---

## Local Development

Run the frontend and backend together in watch mode:

```bash
# Copy the example env file and fill in your Azure credentials
cp .env.example .env

yarn start
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:7007](http://localhost:7007)

Environment variables are loaded from `.env` automatically via `dotenv-cli`. See [azure-auth-setup.md](azure-auth-setup.md) for how to obtain the Azure values.

---

## Building the Container Image

The root `Dockerfile` is a multi-stage build. It compiles the frontend and backend entirely inside Docker — no local build step required.

```bash
docker build -t backstage:latest .
```

To tag for a container registry:

```bash
docker build -t <registry>/backstage:<tag> .
```

### What the build does

| Stage | Description |
|---|---|
| `build` | Installs all dependencies, runs `tsc`, builds frontend + backend bundles |
| runtime | Copies only production artifacts, installs production dependencies, exposes port 7007 |

Build arguments are not required. All runtime configuration is injected via environment variables.

---

## Running Locally with Docker Compose

Docker Compose starts Backstage and a PostgreSQL database together. This is the recommended way to test the container image before deploying.

```bash
# Ensure .env has the required variables (see Environment Variables below)
docker compose up
```

To rebuild the image and start:

```bash
docker compose up --build
```

Open [http://localhost:7007](http://localhost:7007) once both services are healthy.

To stop and remove containers:

```bash
docker compose down

# Also remove the PostgreSQL volume (deletes all catalog data)
docker compose down -v
```

### Required environment variables for Docker Compose

Set these in your `.env` file:

```bash
# Azure AD — required for Microsoft sign-in
AZURE_CLIENT_ID=<app-registration-client-id>
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_SECRET=<client-secret>   # not needed on AKS with workload identity

# PostgreSQL (defaults shown — change for production)
POSTGRES_PASSWORD=backstage

# Public URLs (defaults to localhost — override for non-local deployments)
APP_BASE_URL=http://localhost:7007
BACKEND_BASE_URL=http://localhost:7007
```

---

## Deploying to AKS

### 1. Push the image to a container registry

```bash
az acr login --name <your-acr-name>

docker build -t <your-acr-name>.azurecr.io/backstage:<tag> .
docker push <your-acr-name>.azurecr.io/backstage:<tag>
```

### 2. Configure workload identity

Ensure the AKS cluster has the OIDC issuer and workload identity webhook enabled:

```bash
az aks update \
  --resource-group <rg> \
  --name <cluster> \
  --enable-oidc-issuer \
  --enable-workload-identity
```

Create the Kubernetes service account with the Azure AD annotations:

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

Add the federated credential on the app registration — see [azure-auth-setup.md](azure-auth-setup.md) for the full steps.

### 3. Create the namespace and secrets

```bash
kubectl create namespace backstage

# PostgreSQL credentials
kubectl create secret generic backstage-postgres \
  --namespace backstage \
  --from-literal=POSTGRES_PASSWORD=<password>
```

No Azure credential secret is needed — workload identity injects the token file automatically.

### 4. Deploy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backstage
  namespace: backstage
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backstage
  template:
    metadata:
      labels:
        app: backstage
        azure.workload.identity/use: "true"   # enables workload identity injection
    spec:
      serviceAccountName: backstage
      containers:
        - name: backstage
          image: <your-acr-name>.azurecr.io/backstage:<tag>
          ports:
            - containerPort: 7007
          env:
            - name: APP_BASE_URL
              value: "https://<your-backstage-domain>"
            - name: BACKEND_BASE_URL
              value: "https://<your-backstage-domain>"
            - name: AZURE_CLIENT_ID
              value: "<AZURE_CLIENT_ID>"
            - name: AZURE_TENANT_ID
              value: "<AZURE_TENANT_ID>"
            - name: POSTGRES_HOST
              value: "<postgres-host>"
            - name: POSTGRES_PORT
              value: "5432"
            - name: POSTGRES_USER
              value: backstage
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: backstage-postgres
                  key: POSTGRES_PASSWORD
          readinessProbe:
            httpGet:
              path: /healthcheck
              port: 7007
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthcheck
              port: 7007
            initialDelaySeconds: 60
            periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: backstage
  namespace: backstage
spec:
  selector:
    app: backstage
  ports:
    - port: 80
      targetPort: 7007
```

Apply:

```bash
kubectl apply -f deploy/backstage.yaml
```

### 5. Expose via ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backstage
  namespace: backstage
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  tls:
    - hosts:
        - backstage.yourdomain.com
      secretName: backstage-tls
  rules:
    - host: backstage.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backstage
                port:
                  number: 80
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_BASE_URL` | Yes | — | Public URL of the Backstage app (used by the browser) |
| `BACKEND_BASE_URL` | Yes | — | Public URL of the backend API (same as `APP_BASE_URL` when serving from one port) |
| `AZURE_CLIENT_ID` | Yes | — | App registration client ID |
| `AZURE_TENANT_ID` | Yes | — | Azure AD tenant ID |
| `AZURE_CLIENT_SECRET` | Local dev only | — | Client secret — not used when `AZURE_FEDERATED_TOKEN_FILE` is present |
| `AZURE_FEDERATED_TOKEN_FILE` | AKS only | — | Injected automatically by the workload identity webhook |
| `POSTGRES_HOST` | Yes | — | PostgreSQL hostname |
| `POSTGRES_PORT` | Yes | — | PostgreSQL port |
| `POSTGRES_USER` | Yes | — | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker build` fails on native modules | `build-essential` or `python3` missing | Ensure the build stage apt-get installs succeed; check network access in your build environment |
| Container exits immediately | Missing required env var | Check `docker logs <container>` for `Config error` messages |
| `ECONNREFUSED` connecting to PostgreSQL | DB not ready or wrong host | Verify `POSTGRES_HOST` points to the correct host; for compose, ensure `depends_on` with healthcheck is working |
| Sign-in fails in container | `APP_BASE_URL` / redirect URI mismatch | Ensure `APP_BASE_URL` matches the redirect URI registered in the Azure app registration |
| `AZURE_FEDERATED_TOKEN_FILE` not found on AKS | Workload identity not configured on pod | Add `azure.workload.identity/use: "true"` label to the pod and set `serviceAccountName` |
