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

import { Messages } from '@salesforce/core';
import type { components } from '../generated/heroku-platform-api.js';
import {
  createHerokuClient,
  listHerokuFormation,
  listHerokuBuilds,
  createHerokuLogSession,
  fetchHerokuBuildOutputStream,
  updateHerokuFormation,
  HerokuApiError,
} from './herokuApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Compute-domain counterpart to computeConnectApi.ts: same function-for-function shapes
// (fetchComputeBuildOutput / createComputeLogSession), but talking to Heroku directly with
// HEROKU_API_TOKEN instead of the org. herokuApi.ts stays a dumb typed-HTTP layer; this file
// owns the --name -> app_id_or_name mapping, Messages.createError conventions, and the
// not-found/auth-failed/generic-failure classification so command files don't have to.
//
// --name is used verbatim as Heroku's app_id_or_name path param in every function below.
// PlatformComputeApp.ExternalAppIdentifier (the Heroku app UUID) is apiAccess="isSfdcInternal"
// and unreachable via the Tooling API queryComputeApp() uses, and there's no DeveloperName<->
// Heroku-app-name naming convention to fall back on instead (see
// PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md:393). This is a known, accepted limitation of
// HEROKU_API_TOKEN mode -- error.herokuAppNotFound's message tells the user how to work around it.

// If a second no-fallback caller shows up alongside scaleComputeFormationViaHeroku below,
// parameterize this (e.g. an options bag for message-key overrides) instead of copy-pasting
// its inline 404/401/403 branch again -- duplicating the classification logic across two
// call sites risks drift if it ever needs a new status code.
function throwHerokuComputeError(err: unknown, name: string): never {
  if (err instanceof HerokuApiError) {
    if (err.status === 404) {
      throw messages.createError('error.herokuAppNotFound', [name]);
    }
    if (err.status === 401 || err.status === 403) {
      throw messages.createError('error.herokuAuthFailed', [err.message]);
    }
  }
  throw messages.createError('error.herokuApiRequestFailed', [err instanceof Error ? err.message : String(err)]);
}

export type HerokuFormationSummary = Array<{ type: string; dynoSize?: string; quantity: number }>;

export async function fetchComputeFormationViaHeroku(
  accessToken: string,
  params: { name: string }
): Promise<HerokuFormationSummary> {
  const client = createHerokuClient(accessToken);
  try {
    const formation = await listHerokuFormation(client, params.name);
    return formation.map((f) => ({ type: f.type ?? '-', dynoSize: f.dyno_size?.name, quantity: f.quantity ?? 0 }));
  } catch (err) {
    throwHerokuComputeError(err, params.name);
  }
}

export async function fetchComputeBuildOutputViaHeroku(
  accessToken: string,
  params: { name: string }
): Promise<string | undefined> {
  const client = createHerokuClient(accessToken);
  let builds: Array<components['schemas']['Build']>;
  try {
    builds = await listHerokuBuilds(client, params.name);
  } catch (err) {
    throwHerokuComputeError(err, params.name);
  }

  // "Oldest first" per the spec -- the last element is the latest build.
  const latestBuild = builds.at(-1);
  if (!latestBuild?.output_stream_url) {
    return undefined;
  }

  try {
    return await fetchHerokuBuildOutputStream(latestBuild.output_stream_url, accessToken);
  } catch (err) {
    throwHerokuComputeError(err, params.name);
  }
}

// Named HerokuFormationUpdate, not ComputeScaleResult, deliberately: a shared-module type used
// inside a command's result type must not share a name with any command's own exported
// Compute<Cmd>Result type, or `bin/dev.js schema generate` fails with a ts-json-schema-generator
// "multiple definitions" error (it resolves exported type names globally across src/, not
// per-file). Same reason HerokuFormationSummary above isn't named ComputeDisplayResult.
export type HerokuFormationUpdate = { type: string; dynoSize?: string; quantity: number };

// Like the three functions above, scale does fall back to the org-mediated Connect API path
// (updateComputeFormation in computeConnectApi.ts) -- unsetting HEROKU_API_TOKEN switches
// scale.ts back to it -- so its 401/403 case reuses error.herokuAuthFailed's fallback-aware
// actions text rather than a scale-specific variant.
export async function scaleComputeFormationViaHeroku(
  accessToken: string,
  params: { name: string; processType: string; dynoSize?: string; quantity?: number }
): Promise<HerokuFormationUpdate> {
  const client = createHerokuClient(accessToken);
  try {
    const formation = await updateHerokuFormation(client, params.name, params.processType, {
      // eslint-disable-next-line camelcase -- dyno_size is Heroku's FormationUpdateRequest field name
      dyno_size: params.dynoSize ? { name: params.dynoSize } : undefined,
      quantity: params.quantity,
    });
    return {
      type: formation.type ?? params.processType,
      dynoSize: formation.dyno_size?.name,
      quantity: formation.quantity ?? 0,
    };
  } catch (err) {
    if (err instanceof HerokuApiError && err.status === 404) {
      throw messages.createError('error.herokuFormationNotFound', [params.name, params.processType]);
    }
    if (err instanceof HerokuApiError && (err.status === 401 || err.status === 403)) {
      throw messages.createError('error.herokuAuthFailed', [err.message]);
    }
    throwHerokuComputeError(err, params.name);
  }
}

export async function createComputeLogSessionViaHeroku(
  accessToken: string,
  params: { name: string; lines?: number; tail?: boolean }
): Promise<{ logplexUrl: string }> {
  const client = createHerokuClient(accessToken);
  let session: components['schemas']['LogSession'];
  try {
    session = await createHerokuLogSession(client, params.name, { lines: params.lines, tail: params.tail });
  } catch (err) {
    throwHerokuComputeError(err, params.name);
  }

  if (!session.logplex_url) {
    throw messages.createError('error.herokuApiRequestFailed', ["Heroku's response was missing a logplex_url"]);
  }
  return { logplexUrl: session.logplex_url };
}
