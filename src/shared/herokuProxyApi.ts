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

import {type Connection, Messages, type SfError} from '@salesforce/core';

import type {components} from '../generated/heroku-platform-api.js';

import {resolveComputeApiVersion} from './metadataApiVersion.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

const HEROKU_API_BASE_URL = 'https://api.heroku.com';
const HEROKU_ACCEPT_HEADER = 'application/vnd.heroku+json; version=3';
// Heroku's telemetry-drains endpoints are only exposed under the `3.sdk` Accept variant -- the plain
// `version=3` media type 406s them. Scoped to the telemetry functions below via a per-call header
// override (see listTelemetryDrainsViaProxy et al.); promoting it to the module default would wrongly
// change the Accept for every other (App/Formation/ConfigVars/Release/Build/LogSession) call.
const HEROKU_ACCEPT_HEADER_SDK = 'application/vnd.heroku+json; version=3.sdk';

// Distinguishes the two error shapes the /services/data/vXX.0/connect/compute/proxy endpoint can return,
// without forcing every caller to re-derive which one it got:
// - 'proxy': the proxy itself rejected the request (bad proxy_url, 502 on the 25 MiB response
//   cap, etc.) -- its body is [{ errorCode: 'HEROKU_PROXY_ERROR', message }].
// - 'heroku': Heroku's own passthrough error surfaced -- its body is { id, message, url? }, with
//   Heroku's real HTTP status preserved on the wire (jsforce's HttpApiError doesn't expose that
//   status as a typed field, only the parsed body, so callers key off `herokuErrorId`, not a
//   status code).
export class HerokuProxyError extends Error {
  // Heroku's own machine-readable `id` (e.g. 'not_found') when origin === 'heroku'; undefined for
  // a proxy-originated error, which has no equivalent field.
  public readonly herokuErrorId?: string;
  public readonly origin: 'heroku' | 'proxy';

  public constructor(message: string, origin: 'heroku' | 'proxy', herokuErrorId?: string) {
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
  const httpErr = err as {data?: {id?: string}; errorCode?: string; message?: string};
  if (httpErr.errorCode === 'HEROKU_PROXY_ERROR') {
    return new HerokuProxyError(httpErr.message ?? 'The Salesforce Heroku proxy rejected the request.', 'proxy');
  }

  return new HerokuProxyError(httpErr.message ?? 'Heroku rejected the request.', 'heroku', httpErr.data?.id);
}

type HerokuProxyRequestOptions = {
  body?: unknown;
  /** Extra headers forwarded to Heroku through the proxy (e.g. Range for release pagination). */
  headers?: Record<string, string>;
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  /** Path params substituted into `path`'s `{...}` placeholders. */
  params?: Record<string, string>;
  /** Heroku Platform API path, e.g. `/apps/{app_id_or_name}/formation`. */
  path: string;
};

// THE ONLY function in this plugin that knows the /services/data/vXX.0/connect/compute/proxy?proxy_url=...
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
    // Replacer function so the encoded value is inserted verbatim, never read as a $-pattern.
    targetPath = targetPath.replace(`{${key}}`, () => encodeURIComponent(value));
  }

  const targetUrl = `${HEROKU_API_BASE_URL}${targetPath}`;
  const version = resolveComputeApiVersion(connection);
  const proxyUrl = `/services/data/v${version}/connect/compute/proxy?proxy_url=${encodeURIComponent(targetUrl)}`;

  try {
    return await connection.request<T>({
      method: opts.method,
      url: proxyUrl,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers: {'Content-Type': 'application/json', Accept: HEROKU_ACCEPT_HEADER, ...opts.headers},
    });
  } catch (error) {
    throw toHerokuProxyError(error);
  }
}

// notFoundMessage lets a caller override the not_found classification with a more specific error
// (e.g. scaleComputeFormationViaProxy's "no such process type" instead of "no such app") without
// duplicating the origin/herokuErrorId checks at each call site. `name` feeds ONLY the default
// not_found message; callers that always pass a notFoundMessage override (the drain-id telemetry
// functions, which have no app name in scope) pass `undefined` for it.
function throwHerokuProxyComputeError(err: unknown, name: string | undefined, notFoundMessage?: SfError): never {
  if (err instanceof HerokuProxyError && err.origin === 'heroku' && err.herokuErrorId === 'not_found') {
    throw notFoundMessage ?? messages.createError('error.herokuAppNotFound', [name ?? '']);
  }

  if (err instanceof HerokuProxyError && err.origin === 'proxy') {
    throw messages.createError('error.herokuProxyRequestFailed', [err.message]);
  }

  // A Heroku-origin error that carries Heroku's own machine-readable id (herokuErrorId defined, e.g.
  // 'invalid_params' on a 422 -- the most common create/update failure: a bad endpoint URL or a
  // rejected signal/exporter combination) is a request Heroku *received and rejected*, so surface
  // Heroku's own message as a rejection. A heroku-origin error WITHOUT an id (herokuErrorId
  // undefined -- a connectivity/parse failure with no structured Heroku body, e.g. a socket error)
  // falls through to the connectivity-flavored herokuApiRequestFailed below, which is accurate for it.
  if (err instanceof HerokuProxyError && err.origin === 'heroku' && err.herokuErrorId !== undefined) {
    throw messages.createError('error.herokuRequestRejected', [err.message]);
  }

  throw messages.createError('error.herokuApiRequestFailed', [err instanceof Error ? err.message : String(err)]);
}

// Fields are optional because Heroku's App schema marks them all optional, so a missing one renders
// as a placeholder dash rather than failing the fetch.
export type HerokuAppSummary = {generation?: string; name?: string; region?: string};

export async function fetchComputeAppViaProxy(
  connection: Connection,
  params: {appId: string; name: string},
): Promise<HerokuAppSummary | undefined> {
  try {
    const app = await herokuProxyRequest<components['schemas']['App']>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}',
      params: {app_id_or_name: params.appId},
    });
    const summary: HerokuAppSummary = {name: app.name, region: app.region?.name, generation: app.generation?.name};
    return summary.name === undefined && summary.region === undefined && summary.generation === undefined
      ? undefined
      : summary;
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

export type HerokuFormationSummary = Array<{dynoSize?: string; quantity: number; type: string}>;

export async function fetchComputeFormationViaProxy(
  connection: Connection,
  params: {appId: string; name: string},
): Promise<HerokuFormationSummary> {
  try {
    const formation = await herokuProxyRequest<Array<components['schemas']['Formation']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/formation',

      params: {app_id_or_name: params.appId},
    });
    return formation.map(f => ({type: f.type ?? '-', dynoSize: f.dyno_size?.name, quantity: f.quantity ?? 0}));
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

// Named HerokuFormationUpdate, not ComputeScaleResult, deliberately: a shared-module type used
// inside a command's result type must not share a name with any command's own exported
// Compute<Cmd>Result type, or `bin/dev.js schema generate` fails with a ts-json-schema-generator
// "multiple definitions" error (it resolves exported type names globally across src/, not
// per-file). Same reason HerokuFormationSummary above isn't named ComputeDisplayResult.
export type HerokuFormationUpdate = {dynoSize?: string; quantity: number; type: string};

export async function scaleComputeFormationViaProxy(
  connection: Connection,
  params: {appId: string; dynoSize?: string; name: string; processType: string; quantity?: number},
): Promise<HerokuFormationUpdate> {
  try {
    const formation = await herokuProxyRequest<components['schemas']['Formation']>(connection, {
      method: 'PATCH',
      path: '/apps/{app_id_or_name}/formation/{formation_id_or_type}',
      params: {

        app_id_or_name: params.appId,

        formation_id_or_type: params.processType,
      },
      body: {

        dyno_size: params.dynoSize ? {name: params.dynoSize} : undefined,
        quantity: params.quantity,
      } satisfies components['schemas']['FormationUpdateRequest'],
    });
    return {
      type: formation.type ?? params.processType,
      dynoSize: formation.dyno_size?.name,
      quantity: formation.quantity ?? 0,
    };
  } catch (error) {
    throwHerokuProxyComputeError(
      error,
      params.name,
      messages.createError('error.herokuFormationNotFound', [params.name, params.processType]),
    );
  }
}

export async function fetchComputeConfigVarsViaProxy(
  connection: Connection,
  params: {appId: string; name: string},
): Promise<Record<string, string>> {
  try {
    return await herokuProxyRequest<components['schemas']['ConfigVars']>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/config-vars',

      params: {app_id_or_name: params.appId},
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

export async function updateComputeConfigVarsViaProxy(
  connection: Connection,
  params: {appId: string; name: string; updates: Record<string, null | string>},
): Promise<Record<string, string>> {
  try {
    return await herokuProxyRequest<components['schemas']['ConfigVars']>(connection, {
      method: 'PATCH',
      path: '/apps/{app_id_or_name}/config-vars',

      params: {app_id_or_name: params.appId},
      body: params.updates satisfies components['schemas']['ConfigVarsUpdate'],
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

// Shared by display.ts (formation display) and config/set.ts + config/unset.ts (post-update
// release number) -- the one place that owns "list releases, take the highest version number."
// Range: version ..; max=1; order=desc asks Heroku for just the single highest-version release,
// but Math.max is still applied defensively rather than trusting max=1 to always return exactly
// one element. Returns undefined (not an error) for a brand-new app with no releases yet.
export async function fetchLatestReleaseVersionViaProxy(
  connection: Connection,
  params: {appId: string; name: string},
): Promise<number | undefined> {
  try {
    const releases = await herokuProxyRequest<Array<components['schemas']['Release']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/releases',

      params: {app_id_or_name: params.appId},
      headers: {Range: 'version ..; max=1; order=desc'},
    });
    const versions = releases.map(r => r.version).filter((v): v is number => v !== undefined);
    return versions.length === 0 ? undefined : Math.max(...versions);
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

export type HerokuLogSession = {logplexUrl: string};

// Used by get/runtime-log.ts and tail/runtime-log.ts. `name` rides in the path (app_id_or_name),
// not the request body -- unlike the
// old /connect/compute/logs/session Connect resource, Heroku's own createLogSession takes the app
// only as a path param.
export async function createComputeLogSessionViaProxy(
  connection: Connection,
  params: {appId: string; lines?: number; name: string; tail?: boolean},
): Promise<HerokuLogSession> {
  try {
    const session = await herokuProxyRequest<components['schemas']['LogSession']>(connection, {
      method: 'POST',
      path: '/apps/{app_id_or_name}/log-sessions',

      params: {app_id_or_name: params.appId},
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

    return {logplexUrl: session.logplex_url};
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
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
  params: {appId: string; name: string},
): Promise<string | undefined> {
  try {
    const builds = await herokuProxyRequest<Array<components['schemas']['Build']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/builds',

      params: {app_id_or_name: params.appId},
    });
    return builds.at(-1)?.output_stream_url;
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

// One of Heroku's telemetry-drain exporter types: `otlp` (OTLP/gRPC), `otlphttp` (OTLP/HTTP), or
// `splunk`. Derived from the generated spec so it stays in lockstep with the enum in
// api-specs/heroku-platform-api.yaml. computeTelemetryDrain.ts maps a user-facing --transport onto
// one of these (and back, for display).
export type TelemetryExporterType = components['schemas']['TelemetryDrainCreateRequest']['exporter']['type'];

// One of the three OpenTelemetry signal categories a drain can forward. Also derived from the spec.
export type TelemetrySignal = components['schemas']['TelemetryDrainCreateRequest']['signals'][number];

// The five telemetry-drain functions below back the follow-up `sf compute telemetry-drain` subcommand
// WIs; they ship now as the shared foundation. Each returns the raw generated TelemetryDrain wire type
// (no plugin-side summary) -- presentation lives in computeTelemetryDrain.ts (formatTelemetryDrainRows),
// mirroring the config-vars split rather than the formation one. All pass HEROKU_ACCEPT_HEADER_SDK.
//
// Runtime dependency (not enforceable here): /apps/{id}/telemetry-drains and /telemetry-drains[/{id}]
// must be on the Salesforce Connect proxy allow-list, or every call below 502s as a HEROKU_PROXY_ERROR.
export async function listTelemetryDrainsViaProxy(
  connection: Connection,
  params: {appId: string; name: string},
): Promise<Array<components['schemas']['TelemetryDrain']>> {
  try {
    return await herokuProxyRequest<Array<components['schemas']['TelemetryDrain']>>(connection, {
      method: 'GET',
      path: '/apps/{app_id_or_name}/telemetry-drains',
      params: {app_id_or_name: params.appId},
      headers: {Accept: HEROKU_ACCEPT_HEADER_SDK},
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

export async function fetchTelemetryDrainViaProxy(
  connection: Connection,
  params: {drainId: string},
): Promise<components['schemas']['TelemetryDrain']> {
  try {
    return await herokuProxyRequest<components['schemas']['TelemetryDrain']>(connection, {
      method: 'GET',
      path: '/telemetry-drains/{telemetry_drain_id}',
      params: {telemetry_drain_id: params.drainId},
      headers: {Accept: HEROKU_ACCEPT_HEADER_SDK},
    });
  } catch (error) {
    // A 404 on a drain-id path means the drain wasn't found, so always override the default
    // app-not-found classification with a drain-specific message (no app name is in scope here).
    throwHerokuProxyComputeError(error, undefined, messages.createError('error.telemetryDrainNotFound', [params.drainId]));
  }
}

export async function createTelemetryDrainViaProxy(
  connection: Connection,
  params: {
    appId: string;
    endpoint: string;
    exporterType: TelemetryExporterType;
    headers?: Record<string, string>;
    name: string;
    signals: TelemetrySignal[];
  },
): Promise<components['schemas']['TelemetryDrain']> {
  try {
    return await herokuProxyRequest<components['schemas']['TelemetryDrain']>(connection, {
      method: 'POST',
      path: '/telemetry-drains',
      body: {
        owner: {id: params.appId, type: 'app'},
        signals: params.signals,
        exporter: {type: params.exporterType, endpoint: params.endpoint, headers: params.headers},
      } satisfies components['schemas']['TelemetryDrainCreateRequest'],
      headers: {Accept: HEROKU_ACCEPT_HEADER_SDK},
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, params.name);
  }
}

export async function updateTelemetryDrainViaProxy(
  connection: Connection,
  params: {
    drainId: string;
    exporter?: {endpoint?: string; headers?: Record<string, string>; type?: TelemetryExporterType};
    signals?: TelemetrySignal[];
  },
): Promise<components['schemas']['TelemetryDrain']> {
  try {
    return await herokuProxyRequest<components['schemas']['TelemetryDrain']>(connection, {
      method: 'PATCH',
      path: '/telemetry-drains/{telemetry_drain_id}',
      params: {telemetry_drain_id: params.drainId},
      body: {
        signals: params.signals,
        exporter: params.exporter,
      } satisfies components['schemas']['TelemetryDrainUpdateRequest'],
      headers: {Accept: HEROKU_ACCEPT_HEADER_SDK},
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, undefined, messages.createError('error.telemetryDrainNotFound', [params.drainId]));
  }
}

// Heroku's DELETE returns the deleted drain's representation, so this resolves to it (callers can
// confirm what was removed) rather than void.
export async function deleteTelemetryDrainViaProxy(
  connection: Connection,
  params: {drainId: string},
): Promise<components['schemas']['TelemetryDrain']> {
  try {
    return await herokuProxyRequest<components['schemas']['TelemetryDrain']>(connection, {
      method: 'DELETE',
      path: '/telemetry-drains/{telemetry_drain_id}',
      params: {telemetry_drain_id: params.drainId},
      headers: {Accept: HEROKU_ACCEPT_HEADER_SDK},
    });
  } catch (error) {
    throwHerokuProxyComputeError(error, undefined, messages.createError('error.telemetryDrainNotFound', [params.drainId]));
  }
}
