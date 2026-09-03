# **APP_NAME**

Compute app scaffolded by `sf compute generate --language python`, built on
the Heroku AppLink Python starter (FastAPI).

## Endpoints

- `GET /` -- public welcome endpoint.
- `GET /health` -- public health check endpoint.
- `POST /handleDataCloudDataChangeEvent/` -- public webhook for Data Cloud events.
- `GET /docs` -- interactive Swagger UI generated from `api-spec.yaml`.
- `GET /api/accounts/` -- (protected) query Accounts in the invoking org.
- `POST /api/unitofwork/` -- (protected) create an Account, Contact, and
  related Cases in a single transaction via the Unit of Work pattern.

## Local development

```
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Deploy

```
sf compute deploy --target-org <org>
```
