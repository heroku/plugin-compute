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

import type { Connection } from '@salesforce/core';
import { Messages } from '@salesforce/core';
import type { components } from '../generated/heroku-platform-api.js';
import { resolveComputeApiVersion } from './metadataApiVersion.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

const HEROKU_API_BASE_URL = 'https://api.heroku.com';
const HEROKU_ACCEPT_HEADER = 'application/vnd.heroku+json; version=3';

// Distinguishes the two error shapes the /services/data/vXX.0/heroku/proxy endpoint can return,
// without forcing every caller to re-derive which one it got:
// - 'proxy': the proxy itself rejected the request (bad proxy_url, 502 on the 25 MiB response
//   cap, etc.) -- its body is [{ errorCode: 'HEROKU_PROXY_ERROR', message }].
// - 'heroku': Heroku's own passthrough error surfaced -- its body is { id, message, url? }, with
//   Heroku's real HTTP status preserved on the wire (jsforce's HttpApiError doesn't expose that
//   status as a typed field, only the parsed body, so callers key off `herokuErrorId`, not a
//   status code).
export class HerokuProxyError extends Error {
  public readonly origin: 'proxy' | 'heroku';
  // Heroku's own machine-readable `id` (e.g. 'not_found') when origin === 'heroku'; undefined for
  // a proxy-originated error, which has no equivalent field.
  public readonly herokuErrorId?: string;

  public constructor(message: string, origin: 'proxy' | 'heroku', herokuErrorId?: string) {
    super(message);
    this.name = 'HerokuProxyError';
    this.origin = origin;
    this.herokuErrorId = herokuErrorId;
  }
}

// jsforce's HttpApi.getError() (http-api.js) unwraps a single-element error array to that
// element, then sets HttpApiError.errorCode from the (possibly unwrapped) object's own errorCode
// field, or leaves it undefined. Confirmed against both shapes this proxy can return:
// - Proxy-originated: [{ errorCode: 'HEROKU_PROXY_ERROR', message }] unwraps to
//   err.errorCode === 'HEROKU_PROXY_ERROR'.
// - Heroku passthrough: { id, message, url? } has no errorCode field, so err.errorCode is
//   undefined -- classified via err.data.id instead. err.data always holds the raw parsed error
//   object either way (HttpApiError's contract).
function toHerokuProxyError(err: unknown): HerokuProxyError {
  const httpErr = err as { errorCode?: string; message?: string; data?: { id?: string } };
  if (httpErr.errorCode === 'HEROKU_PROXY_ERROR') {
    return new HerokuProxyError(httpErr.message ?? 'The Salesforce Heroku proxy rejected the request.', 'proxy');
  }
  return new HerokuProxyError(httpErr.message ?? 'Heroku rejected the request.', 'heroku', httpErr.data?.id);
}

type HerokuProxyRequestOptions = {
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE';
  /** Heroku Platform API path, e.g. `/apps/{app_id_or_name}/formation`. */
  path: string;
  /** Path params substituted into `path`'s `{...}` placeholders. */
  params?: Record<string, string>;
  /** Extra headers forwarded to Heroku through the proxy (e.g. Range for release pagination). */
  headers?: Record<string, string>;
  body?: unknown;
};

// THE ONLY function in this plugin that knows the /services/data/vXX.0/heroku/proxy?proxy_url=...
// shape -- every exported function below calls this and otherwise looks like it's talking to
// Heroku's typed API directly.
//
// proxy_url must carry the full target Heroku URL as a single percent-encoded query param value
// -- connection.request() is used (never raw fetch) so token refresh/retry/proxy settings apply,
// and the literal /services/... path (rather than a relative one) is required so jsforce's
// automatic API-version substitution doesn't undercut the v68+ floor resolveComputeApiVersion
// pins to.
async function herokuProxyRequest<T>(connection: Connection, opts: HerokuProxyRequestOptions): Promise<T> {
  let targetPath = opts.path;
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    targetPath = targetPath.replace(`{${key}}`, encodeURIComponent(value));
  }
  const targetUrl = `${HEROKU_API_BASE_URL}${targetPath}`;
  const version = resolveComputeApiVersion(connection);
  const proxyUrl = `/services/data/v${version}/heroku/proxy?proxy_url=${encodeURIComponent(targetUrl)}`;

  try {
    return await connection.request<T>({
      method: opts.method,
      url: proxyUrl,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers: { 'Content-Type': 'application/json', Accept: HEROKU_ACCEPT_HEADER, ...opts.headers },
    });
  } catch (err) {
    throw toHerokuProxyError(err);
  }
}

// If a second no-fallback caller shows up alongside scaleComputeFormationViaProxy below,
// parameterize this (e.g. an options bag for message-key overrides) instead of copy-pasting its
// inline not_found branch again -- duplicating the classification logic across call sites risks
// drift if it ever needs a new herokuErrorId.
function throwHerokuProxyComputeError(err: unknown, name: string): never {
  if (err instanceof HerokuProxyError && err.origin === 'heroku' && err.herokuErrorId === 'not_found') {
    throw messages.createError('error.herokuAppNotFound', [name]);
  }
  if (err instanceof HerokuProxyError && err.origin === 'proxy') {
    throw messages.createError('error.herokuProxyRequestFailed', [err.message]);
  }
  throw messages.createError('error.herokuApiRequestFailed', [err instanceof Error ? err.message : String(err)]);
}

export type HerokuFormationSummary = Array<{ type: string; dynoSize?: string; quantity: number }>;

export async function fetchComputeFormationViaProxy(
  connection: Connection,
  params: { name: string; appId: string }
): Promise<HerokuFormationSummary> {
  try {
    const formation = await herokuProxyRequest<Array<components['schemas']['Formation']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/formation',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
    });
    return formation.map((f) => ({ type: f.type ?? '-', dynoSize: f.dyno_size?.name, quantity: f.quantity ?? 0 }));
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}

// Named HerokuFormationUpdate, not ComputeScaleResult, deliberately: a shared-module type used
// inside a command's result type must not share a name with any command's own exported
// Compute<Cmd>Result type, or `bin/dev.js schema generate` fails with a ts-json-schema-generator
// "multiple definitions" error (it resolves exported type names globally across src/, not
// per-file). Same reason HerokuFormationSummary above isn't named ComputeDisplayResult.
export type HerokuFormationUpdate = { type: string; dynoSize?: string; quantity: number };

export async function scaleComputeFormationViaProxy(
  connection: Connection,
  params: { name: string; appId: string; processType: string; dynoSize?: string; quantity?: number }
): Promise<HerokuFormationUpdate> {
  try {
    const formation = await herokuProxyRequest<components['schemas']['Formation']>(connection, {
      method: 'PATCH',
      path: '/apps/{app_id_or_name}/formation/{formation_id_or_type}',
      params: {
        // eslint-disable-next-line camelcase -- mirrors Heroku's own path param names
        app_id_or_name: params.appId,
        // eslint-disable-next-line camelcase
        formation_id_or_type: params.processType,
      },
      body: {
        // eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name
        dyno_size: params.dynoSize ? { name: params.dynoSize } : undefined,
        quantity: params.quantity,
      } satisfies components['schemas']['FormationUpdateRequest'],
    });
    return {
      type: formation.type ?? params.processType,
      dynoSize: formation.dyno_size?.name,
      quantity: formation.quantity ?? 0,
    };
  } catch (err) {
    if (err instanceof HerokuProxyError && err.origin === 'heroku' && err.herokuErrorId === 'not_found') {
      throw messages.createError('error.herokuFormationNotFound', [params.name, params.processType]);
    }
    throwHerokuProxyComputeError(err, params.name);
  }
}

export async function fetchComputeConfigVarsViaProxy(
  connection: Connection,
  params: { name: string; appId: string }
): Promise<Record<string, string>> {
  try {
    return await herokuProxyRequest<components['schemas']['ConfigVars']>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/config-vars',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
    });
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}

export async function updateComputeConfigVarsViaProxy(
  connection: Connection,
  params: { name: string; appId: string; updates: Record<string, string | null> }
): Promise<Record<string, string>> {
  try {
    return await herokuProxyRequest<components['schemas']['ConfigVars']>(connection, {
      method: 'PATCH',
      path: '/apps/{app_id_or_name}/config-vars',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
      body: params.updates satisfies components['schemas']['ConfigVarsUpdate'],
    });
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}

// Shared by display.ts (formation display) and config/set.ts + config/unset.ts (post-update
// release number) -- the one place that owns "list releases, take the highest version number."
// Range: version ..; max=1; order=desc asks Heroku for just the single highest-version release,
// but Math.max is still applied defensively rather than trusting max=1 to always return exactly
// one element. Returns undefined (not an error) for a brand-new app with no releases yet.
export async function fetchLatestReleaseVersionViaProxy(
  connection: Connection,
  params: { name: string; appId: string }
): Promise<number | undefined> {
  try {
    const releases = await herokuProxyRequest<Array<components['schemas']['Release']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/releases',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
      headers: { Range: 'version ..; max=1; order=desc' },
    });
    const versions = releases.map((r) => r.version).filter((v): v is number => v !== undefined);
    return versions.length === 0 ? undefined : Math.max(...versions);
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}

export type HerokuLogSession = { logplexUrl: string };

// Used by logs.ts. `name` rides in the path (app_id_or_name), not the request body -- unlike the
// old /connect/compute/logs/session Connect resource, Heroku's own createLogSession takes the app
// only as a path param.
export async function createComputeLogSessionViaProxy(
  connection: Connection,
  params: { name: string; appId: string; lines?: number; tail?: boolean }
): Promise<HerokuLogSession> {
  try {
    const session = await herokuProxyRequest<components['schemas']['LogSession']>(connection, {
      method: 'POST',
      path: '/apps/{app_id_or_name}/log-sessions',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
      body: {
        lines: params.lines,
        tail: params.tail,
      } satisfies components['schemas']['LogSessionCreateRequest'],
    });
    if (!session.logplex_url) {
      throw messages.createError('error.herokuApiRequestFailed', [
        'Heroku returned a log session with no logplex_url.',
      ]);
    }
    return { logplexUrl: session.logplex_url };
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}

// Used by build/output.ts. There's no by-id path to a build's output_stream_url from the CLI's
// side -- the only build identifier available is PlatformComputeAppBuild's Salesforce record Id
// (from CurrentBuild.Id), not a Heroku build UUID, so getBuild-by-id isn't reachable. listBuilds
// returns oldest-first, so the latest build is the last element. Returns undefined (not an error)
// both when the app has no builds yet on Heroku's side and when the latest build hasn't produced
// output_stream_url yet -- build/output.ts treats both the same as the old Connect resource's 404.
export async function fetchLatestBuildOutputStreamUrlViaProxy(
  connection: Connection,
  params: { name: string; appId: string }
): Promise<string | undefined> {
  try {
    const builds = await herokuProxyRequest<Array<components['schemas']['Build']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/builds',
      // eslint-disable-next-line camelcase -- app_id_or_name mirrors Heroku's own path param name
      params: { app_id_or_name: params.appId },
    });
    return builds.at(-1)?.output_stream_url;
  } catch (err) {
    throwHerokuProxyComputeError(err, params.name);
  }
}
