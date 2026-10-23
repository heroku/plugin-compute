/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {Language} from './computeGenerateSource.js';

// These files can't be produced by trimming the fetched upstream copy: the example endpoints
// they exist to teach (Accounts query, UnitOfWork, Data Cloud webhook) are woven into the
// route/router registration, the OpenAPI paths, and the README prose, not appended after some
// boilerplate. Each is authored here instead, modeled on the upstream file it replaces, with a
// commented worked example showing customers the same idiom the reference app uses. project.toml
// has no upstream equivalent at all -- those reference repos don't ship one, since they're not
// built for the Salesforce buildpack pipeline.
//
// Applied over whatever the fetch returns for the same path (see buildStarterFiles in
// commands/compute/generate.ts) -- these always win, regardless of what's in the tarball.
export const GENERATED_SKELETONS: Record<Language, Record<string, string>> = {
  node: {
    'project.toml': `[_]
schema-version = "0.2"

[[io.buildpacks.group]]
id = "heroku/nodejs"

[[io.buildpacks.group]]
id = "heroku/heroku-applink"

[[io.buildpacks.group]]
id = "heroku/procfile"
`,
    'api-spec.yaml': `openapi: 3.0.0
info:
  version: 1.0.0
  title: __APP_NAME__ API
  description: __APP_NAME__ compute app, exposing APIs in Node.js with Fastify to connected Salesforce and Data Cloud orgs.
servers:
  - url: http://127.0.0.1:3000
# Add your operations under \`paths\` below - one entry per route registered in
# src/routes/. Every operation that touches Salesforce data needs an
# x-sfdc.heroku.authorization block naming the External Client App (and, for
# elevated access, a session-based Permission Set) that grants it access. For
# example, matching the /hello route sketched in src/routes/index.js:
#
# paths:
#   /hello:
#     get:
#       operationId: Hello
#       x-sfdc:
#         heroku:
#           authorization:
#             externalClientApp: 'MyAppLinkExternalClientApp'
#       responses:
#         '200':
#           description: Successful response
paths: {}
`,
    'src/routes/index.js': `export default async function (_fastify, _opts) {
  // Add your routes here. Every route registered this way automatically gets
  // the Salesforce preHandler from ../plugins/heroku-applink.js, which
  // decodes the invoking org's context onto request.sdk. For example:
  //
  // fastify.get('/hello', async function (request, _reply) {
  //   const { context, logger } = request.sdk;
  //   const org = context.org;
  //
  //   logger.info(\`GET /hello for org \${org.id}\`);
  //   const result = await org.dataApi.query('SELECT Id, Name FROM Account LIMIT 1');
  //   return result.records.map((rec) => rec.fields);
  // });
}
`,
    'test/routes/healthcheck.test.js': `import { test } from 'tap';
import { build } from '../helper.js';

// Smoke test so \`npm test\` has something to run; add tests for your own routes alongside it.
test('GET /healthcheck responds OK', async t => {
  const app = await build(t);

  const response = await app.inject({ method: 'GET', url: '/healthcheck' });

  t.equal(response.statusCode, 200);
  t.equal(response.payload, 'OK');
});
`,
    'README.md': `# __APP_NAME__

Compute app scaffolded by \`sf compute generate --language node\`, built on the
Heroku AppLink Node.js starter (Fastify).

## Endpoints

- \`GET /api-docs\` -- interactive Swagger UI generated from \`api-spec.yaml\`.
- \`GET /healthcheck\` -- used by the AppLink Service Mesh to check app health.

Add your own routes in \`src/routes/index.js\` (see the commented example
there), and a matching operation in \`api-spec.yaml\` for each one that should
be published as an External Service.

## Local development

\`\`\`
npm install
npm run dev
\`\`\`

## Deploy

\`\`\`
sf project deploy start --target-org <org>
\`\`\`
`,
  },
  python: {
    'project.toml': `[_]
schema-version = "0.2"

[[io.buildpacks.group]]
id = "heroku/python"

[[io.buildpacks.group]]
id = "heroku/heroku-applink"

[[io.buildpacks.group]]
id = "heroku/procfile"
`,
    'api-spec.yaml': `openapi: 3.0.0
info:
  version: 1.0.0
  title: __APP_NAME__ API
  description: __APP_NAME__ compute app, exposing APIs to connected Salesforce and Data Cloud orgs.
servers:
  - url: /
# Add your operations under \`paths\` below - one entry per router mounted on
# sf_app in app/main.py. Every operation that touches Salesforce data needs
# an x-sfdc.heroku.authorization block naming the External Client App (and,
# for elevated access, a session-based Permission Set) that grants it
# access. For example, matching the /hello router sketched in app/main.py:
#
# paths:
#   /api/hello/:
#     get:
#       operationId: Hello
#       x-sfdc:
#         heroku:
#           authorization:
#             externalClientApp: 'MyAppLinkExternalClientApp'
#       responses:
#         '200':
#           description: Successful response
paths: {}
`,
    'app/main.py': `"""
This module is the main entry point for the __APP_NAME__ compute app.

It initializes a main FastAPI application for public endpoints and mounts a
sub-application for all endpoints that require Salesforce context.
"""
import heroku_applink as sdk
from fastapi import FastAPI
from typing import Dict
import yaml

# --- Protected Salesforce App ---
# All routers and middleware that require Salesforce context are attached here.
sf_app = FastAPI()
sf_app.add_middleware(sdk.IntegrationAsgiMiddleware, config=sdk.Config())

# Add your routers here, e.g.:
#
# from .routers import hello
# sf_app.include_router(hello.router, prefix="/hello")
#
# Every route on a router mounted on sf_app can call sdk.get_client_context()
# to read the invoking org's context (context.data_api, context.org, etc.).

# --- Main Public App ---
app = FastAPI(
    title="__APP_NAME__",
    description="Compute app generated by sf compute generate, built on the Heroku AppLink Python starter.",
    version="1.0.0"
)

# Mount the protected Salesforce app at the /api prefix
app.mount("/api", sf_app)

# A webhook (e.g. a Data Cloud Data Action Target) has no invoking-user
# context, so it's attached directly to the public app instead of sf_app -
# add app.include_router(...) calls here for that case.

# Load the OpenAPI spec and attach it to the main app
with open("api-spec.yaml", "r") as f:
    openapi_schema = yaml.safe_load(f)
app.openapi_schema = openapi_schema

@app.get("/", summary="Welcome endpoint")
def read_root() -> Dict[str, str]:
    """
    A welcoming root endpoint that is publicly accessible.

    :return: A welcome message.
    :rtype: Dict[str, str]
    """
    return {
        "message": "Welcome to __APP_NAME__!",
        "docs_url": "/docs",
        "salesforce_api_prefix": "/api"
    }

@app.get("/health", summary="Health check endpoint")
def get_health() -> Dict[str, str]:
    """
    A simple health check endpoint.

    :return: A dictionary with a status of "ok".
    :rtype: Dict[str, str]
    """
    return {"status": "ok"}
`,
    'README.md': `# __APP_NAME__

Compute app scaffolded by \`sf compute generate --language python\`, built on
the Heroku AppLink Python starter (FastAPI).

## Endpoints

- \`GET /\` -- public welcome endpoint.
- \`GET /health\` -- public health check endpoint.
- \`GET /docs\` -- interactive Swagger UI generated from \`api-spec.yaml\`.

Add your own routers under \`app/routers/\` and mount them on \`sf_app\` in
\`app/main.py\` (see the commented example there) for any endpoint that needs
Salesforce context, or on \`app\` directly for a public webhook. Add a
matching operation in \`api-spec.yaml\` for each one that should be published
as an External Service.

## Local development

\`\`\`
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
\`\`\`

## Deploy

\`\`\`
sf project deploy start --target-org <org>
\`\`\`
`,
  },
};
