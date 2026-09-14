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
import type { paths, components } from '../generated/heroku-platform-api.js';

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
 * Used by src/shared/herokuComputeApi.ts, which every `sf compute` command
 * calls instead of the Connect API (computeConnectApi.ts) when
 * HEROKU_API_TOKEN is set -- see getHerokuApiToken() below. Before wiring a
 * new call site here, confirm the endpoint isn't meant to be mirrored by a
 * Connect resource instead; see that spec's Compute tag description for the
 * one case (source retrieve) already flagged as unconfirmed.
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

// Single read point for HEROKU_API_TOKEN -- every command checks Heroku-direct-mode through
// this function rather than reading process.env itself, so tests can toggle the mode in one
// place and there's one spot to change if the env var name ever changes.
export function getHerokuApiToken(): string | undefined {
  return process.env.HEROKU_API_TOKEN;
}

// Carries the HTTP status separately from the message so callers (herokuComputeApi.ts) can
// branch on 404 (app not found) vs. 401/403 (bad token) vs. everything else, without
// string-matching. Built only from HerokuError's own `message` field or a bare "HTTP {status}"
// fallback -- never from raw response headers/bodies, so it can't echo the bearer token back.
export class HerokuApiError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = 'HerokuApiError';
    this.status = status;
  }
}

function toHerokuApiError(
  status: number,
  herokuError: components['schemas']['HerokuError'] | undefined
): HerokuApiError {
  return new HerokuApiError(status, herokuError?.message ?? `HTTP ${status}`);
}

export async function listHerokuFormation(
  client: HerokuClient,
  appIdOrName: string
): Promise<Array<components['schemas']['Formation']>> {
  const { data, error, response } = await client.GET('/apps/{app_id_or_name}/formation', {
    // app_id_or_name is openapi-typescript's generated path-param key name, fixed by the spec.
    // eslint-disable-next-line camelcase
    params: { path: { app_id_or_name: appIdOrName }, header: { Accept: HEROKU_ACCEPT_HEADER } },
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

export async function updateHerokuFormation(
  client: HerokuClient,
  appIdOrName: string,
  formationIdOrType: string,
  body: components['schemas']['FormationUpdateRequest']
): Promise<components['schemas']['Formation']> {
  const { data, error, response } = await client.PATCH('/apps/{app_id_or_name}/formation/{formation_id_or_type}', {
    // app_id_or_name/formation_id_or_type are openapi-typescript's generated path-param key
    // names, fixed by the spec.
    params: {
      // eslint-disable-next-line camelcase
      path: { app_id_or_name: appIdOrName, formation_id_or_type: formationIdOrType },
      header: { Accept: HEROKU_ACCEPT_HEADER },
    },
    body,
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

export async function getHerokuConfigVars(
  client: HerokuClient,
  appIdOrName: string
): Promise<components['schemas']['ConfigVars']> {
  const { data, error, response } = await client.GET('/apps/{app_id_or_name}/config-vars', {
    // app_id_or_name is openapi-typescript's generated path-param key name, fixed by the spec.
    // eslint-disable-next-line camelcase
    params: { path: { app_id_or_name: appIdOrName }, header: { Accept: HEROKU_ACCEPT_HEADER } },
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

export async function updateHerokuConfigVars(
  client: HerokuClient,
  appIdOrName: string,
  body: components['schemas']['ConfigVarsUpdate']
): Promise<components['schemas']['ConfigVars']> {
  const { data, error, response } = await client.PATCH('/apps/{app_id_or_name}/config-vars', {
    // app_id_or_name is openapi-typescript's generated path-param key name, fixed by the spec.
    // eslint-disable-next-line camelcase
    params: { path: { app_id_or_name: appIdOrName }, header: { Accept: HEROKU_ACCEPT_HEADER } },
    body,
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

// "Oldest first" per the spec -- there's no Heroku build UUID available on the Salesforce side
// to look up a specific build by id (PlatformComputeAppBuild.ExternalBuildIdentifier has the
// same isSfdcInternal restriction as the app identifier), so callers take the last element as
// the latest build.
export async function listHerokuBuilds(
  client: HerokuClient,
  appIdOrName: string
): Promise<Array<components['schemas']['Build']>> {
  const { data, error, response } = await client.GET('/apps/{app_id_or_name}/builds', {
    // app_id_or_name is openapi-typescript's generated path-param key name, fixed by the spec.
    // eslint-disable-next-line camelcase
    params: { path: { app_id_or_name: appIdOrName }, header: { Accept: HEROKU_ACCEPT_HEADER } },
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

export async function createHerokuLogSession(
  client: HerokuClient,
  appIdOrName: string,
  body: components['schemas']['LogSessionCreateRequest']
): Promise<components['schemas']['LogSession']> {
  const { data, error, response } = await client.POST('/apps/{app_id_or_name}/log-sessions', {
    // app_id_or_name is openapi-typescript's generated path-param key name, fixed by the spec.
    // eslint-disable-next-line camelcase
    params: { path: { app_id_or_name: appIdOrName }, header: { Accept: HEROKU_ACCEPT_HEADER } },
    body,
  });
  if (error) {
    throw toHerokuApiError(response.status, error);
  }
  return data;
}

// Build.output_stream_url is a plain string field, not a discrete typed operation in the spec,
// so createHerokuClient's typed GET/POST don't cover it -- hence raw fetch here, parallel to
// computeLogStream.ts's raw fetch against logplex URLs. Unlike a logplex URL (pre-authorized,
// no token needed), this URL is still on api.heroku.com and requires the same Bearer token as
// every other Heroku call. A 404 means the build hasn't produced output yet (mirrors the
// Connect API's existing "not yet available" contract in computeConnectApi.ts); any other
// non-2xx is a hard failure. The thrown message is always a bare "HTTP {status}" -- never the
// response body -- since that body has no schema here and could echo request details back.
export async function fetchHerokuBuildOutputStream(
  outputStreamUrl: string,
  accessToken: string
): Promise<string | undefined> {
  const response = await fetch(outputStreamUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'text/plain' },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new HerokuApiError(response.status, `HTTP ${response.status}`);
  }
  return response.text();
}
