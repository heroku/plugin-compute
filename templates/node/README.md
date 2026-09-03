# **APP_NAME**

Compute app scaffolded by `sf compute generate --language node`, built on the
Heroku AppLink Node.js starter (Fastify).

## Endpoints

- `GET /accounts` -- query Accounts in the invoking org (or a connected org
  named by the `SALESFORCE_ORG_NAME` config var).
- `POST /unitofwork` -- create an Account, Contact, and related Cases in a
  single transaction via the Unit of Work pattern, then respond to the
  invoking org via its callback URL.
- `POST /handleDataCloudDataChangeEvent` -- webhook target for Data Cloud
  Data Action events.
- `GET /api-docs` -- interactive Swagger UI generated from `api-spec.yaml`.
- `GET /healthcheck` -- used by the AppLink Service Mesh to check app health.

## Local development

```
npm install
npm run dev
```

## Deploy

```
sf compute deploy --target-org <org>
```
