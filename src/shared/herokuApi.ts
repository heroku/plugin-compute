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

import createClient from 'openapi-fetch';
import type { paths } from '../generated/heroku-platform-api.js';

const HEROKU_API_BASE_URL = 'https://api.heroku.com';
const HEROKU_ACCEPT_HEADER = 'application/vnd.heroku+json; version=3';

/**
 * Typed Heroku Platform API client (GET/POST/PATCH/etc. methods and their
 * request/response shapes are inferred from api-specs/heroku-platform-api.yaml
 * via openapi-fetch -- no hand-written request plumbing).
 *
 * Heroku is a non-Salesforce external service, so calling it with raw fetch is
 * the plugin guide's documented exception to "always use connection.request()".
 *
 * No `sf compute` command calls this yet -- every confirmed-implemented API
 * call today goes through the Salesforce Connect API (computeConnectApi.ts).
 * Before wiring a new call site here, confirm the endpoint isn't meant to be
 * mirrored by a Connect resource instead; see that spec's Compute tag
 * description for the one case (source retrieve) already flagged as unconfirmed.
 */
export function createHerokuClient(accessToken: string): ReturnType<typeof createClient<paths>> {
  return createClient<paths>({
    baseUrl: HEROKU_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: HEROKU_ACCEPT_HEADER,
    },
  });
}

export type HerokuClient = ReturnType<typeof createHerokuClient>;
