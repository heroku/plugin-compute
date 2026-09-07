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

import FormData from 'form-data';
import type { Connection } from '@salesforce/core';
import { Messages } from '@salesforce/core';
import type { components } from '../generated/salesforce-connect-compute.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

export type ComputeSourceUpload = components['schemas']['ComputeSourceUpload'];
export type ConnectError = components['schemas']['ConnectError'];

export type UploadComputeSourceParams = {
  /** DeveloperName of the PlatformComputeApp to deploy source for. */
  name: string;
  /** Deployment bundle tarball contents (OpenAPI spec plus application source). */
  bundle: Buffer;
};

// Calls through connection.request() (never raw fetch/got) so token refresh, the
// caller's chosen API version, and proxy/retry settings all apply -- see
// api-specs/salesforce-connect-compute.yaml for the resource this wraps.
export async function uploadComputeSource(
  connection: Connection,
  params: UploadComputeSourceParams
): Promise<ComputeSourceUpload> {
  const form = new FormData();
  form.append('name', params.name);
  form.append('bundle', params.bundle, {
    filename: 'deployment-bundle.tar.gz',
    contentType: 'application/gzip',
  });

  try {
    return await connection.request<ComputeSourceUpload>({
      method: 'POST',
      url: '/connect/compute/source',
      body: form,
      headers: form.getHeaders(),
    });
  } catch (err) {
    throw messages.createError('error.connectApiRequestFailed', [(err as Error).message]);
  }
}

export type DownloadComputeSourceParams = {
  /** DeveloperName of the PlatformComputeApp to download source for. */
  name: string;
};

// The GET counterpart to uploadComputeSource above -- see the Compute tag description in
// salesforce-connect-compute.yaml. The response body is the same binary deployment-bundle.tar.gz
// uploadComputeSource sends, so this must round-trip exact bytes. connection.request()'s default
// string decoding is UTF-8, which is lossy for arbitrary gzip bytes (any byte >0x7F gets
// re-encoded) -- passing { encoding: 'binary' } (Node's alias for latin1) as the second argument
// makes jsforce decode the response 1:1 into a string, which Buffer.from(str, 'binary') then
// turns back into the exact original bytes.
export async function downloadComputeSource(
  connection: Connection,
  params: DownloadComputeSourceParams
): Promise<Buffer> {
  try {
    const body = await connection.request<string>(
      { method: 'GET', url: `/connect/compute/source?name=${encodeURIComponent(params.name)}` },
      { encoding: 'binary' }
    );
    return Buffer.from(body, 'binary');
  } catch (err) {
    throw messages.createError('error.sourceDownloadFailed', [(err as Error).message]);
  }
}

export type FetchComputeBuildOutputParams = {
  /** DeveloperName of the PlatformComputeApp to fetch build output for. */
  name: string;
};

// Bounded one-shot fetch, not a stream -- `build output` prints one finished-or-in-progress
// build's log, unlike `logs --tail`'s ongoing runtime stream. Returns undefined (not an error)
// when the org hasn't ingested a build listing for this app's current build yet -- the jsforce
// HttpApi error shape sets .errorCode to the parsed Connect error body's errorCode, falling back
// to `ERROR_HTTP_${status}` when the body isn't a recognizable { message, errorCode } shape, so a
// 404 with no parseable body still surfaces as errorCode === 'ERROR_HTTP_404'.
export async function fetchComputeBuildOutput(
  connection: Connection,
  params: FetchComputeBuildOutputParams
): Promise<string | undefined> {
  try {
    return await connection.request<string>({
      method: 'GET',
      url: `/connect/compute/build/output?name=${encodeURIComponent(params.name)}`,
    });
  } catch (err) {
    if ((err as { errorCode?: string }).errorCode === 'ERROR_HTTP_404') {
      return undefined;
    }
    throw messages.createError('error.buildOutputFetchFailed', [(err as Error).message]);
  }
}

export type ComputeFormationUpdate = components['schemas']['ComputeFormationUpdate'];
export type ComputeFormation = components['schemas']['ComputeFormation'];

export type UpdateComputeFormationParams = {
  /** PlatformComputeApp Id or DeveloperName to scale. */
  app: string;
  /** Heroku process type to scale (e.g. web, worker). */
  processType: string;
  dynoSize?: string;
  quantity?: number;
};

// Named ComputeFormationUpdateResult, not ComputeScaleResult, for the same reason
// HerokuFormationUpdate in herokuComputeApi.ts isn't named that -- see its comment.
export type ComputeFormationUpdateResult = { type: string; dynoSize?: string; quantity: number };

// Speculative resource -- see the Compute tag description in salesforce-connect-compute.yaml.
// {app_id_or_name} is deliberately Id-or-DeveloperName (unlike the DeveloperName-only `name`
// used by the other functions in this file); the org resolves it server-side, so this function
// never has to tell the two apart itself. Request/response bodies deliberately mirror Heroku's
// own snake_case dyno_size shape rather than this file's usual camelCase -- see the same tag
// description -- so the flattening into ComputeFormationUpdateResult below happens here, not on
// the wire, mirroring scaleComputeFormationViaHeroku's mapping in herokuComputeApi.ts.
export async function updateComputeFormation(
  connection: Connection,
  params: UpdateComputeFormationParams
): Promise<ComputeFormationUpdateResult> {
  /* eslint-disable camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
  const body: ComputeFormationUpdate = {
    dyno_size: params.dynoSize ? { name: params.dynoSize } : undefined,
    quantity: params.quantity,
  };
  /* eslint-enable camelcase */
  try {
    const formation = await connection.request<ComputeFormation>({
      method: 'PATCH',
      url: `/connect/compute/${encodeURIComponent(params.app)}/formation/${encodeURIComponent(params.processType)}`,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return { type: formation.type, dynoSize: formation.dyno_size?.name, quantity: formation.quantity };
  } catch (err) {
    throw messages.createError('error.formationUpdateFailed', [(err as Error).message]);
  }
}

export type ComputeConfigVars = components['schemas']['ComputeConfigVars'];
export type ComputeConfigVarsUpdate = components['schemas']['ComputeConfigVarsUpdate'];
export type ComputeConfigVarsUpdateResult = components['schemas']['ComputeConfigVarsUpdateResult'];

export type FetchComputeConfigVarsParams = {
  /** PlatformComputeApp Id or DeveloperName to fetch config vars for. */
  app: string;
};

// Speculative resource -- see the Compute tag description in salesforce-connect-compute.yaml.
export async function fetchComputeConfigVars(
  connection: Connection,
  params: FetchComputeConfigVarsParams
): Promise<ComputeConfigVars> {
  try {
    return await connection.request<ComputeConfigVars>({
      method: 'GET',
      url: `/connect/compute/${encodeURIComponent(params.app)}/config-vars`,
    });
  } catch (err) {
    throw messages.createError('error.configVarsFetchFailed', [(err as Error).message]);
  }
}

export type UpdateComputeConfigVarsParams = {
  /** PlatformComputeApp Id or DeveloperName to update config vars for. */
  app: string;
  /** Config var name to new value; null unsets that config var. */
  updates: Record<string, string | null>;
};

export type UpdateComputeConfigVarsResult = { configVars: ComputeConfigVars; release?: number };

// Speculative resource -- see the Compute tag description in salesforce-connect-compute.yaml.
// The request body is a pure mirror of Heroku's ConfigVarsUpdate; the response bundles in the
// resulting release version, which Heroku's own PATCH response doesn't carry (see the same tag
// description for why that departure is sanctioned here but not for the formation resource).
export async function updateComputeConfigVars(
  connection: Connection,
  params: UpdateComputeConfigVarsParams
): Promise<UpdateComputeConfigVarsResult> {
  const body: ComputeConfigVarsUpdate = params.updates;
  try {
    const result = await connection.request<ComputeConfigVarsUpdateResult>({
      method: 'PATCH',
      url: `/connect/compute/${encodeURIComponent(params.app)}/config-vars`,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return { configVars: result.configVars, release: result.release };
  } catch (err) {
    throw messages.createError('error.configVarsUpdateFailed', [(err as Error).message]);
  }
}

export type ComputeLogSessionCreate = components['schemas']['ComputeLogSessionCreate'];
export type ComputeLogSession = components['schemas']['ComputeLogSession'];

export type CreateComputeLogSessionParams = {
  /** DeveloperName of the PlatformComputeApp to create a log session for. */
  name: string;
  /** Number of historical log lines to backfill before new output. */
  lines?: number;
  /** Whether the session should stay open for an ongoing live stream. */
  tail?: boolean;
};

// No benign-404 handling here (unlike fetchComputeBuildOutput) -- callers must run the
// CurrentBuild precheck (see queryComputeApp/toComputeAppSummary) first and short-circuit with a
// friendly "no builds yet" message before ever reaching this call, mirroring build/output.ts.
// Any 404 that still surfaces here is a genuine, unexpected failure.
export async function createComputeLogSession(
  connection: Connection,
  params: CreateComputeLogSessionParams
): Promise<ComputeLogSession> {
  const body: ComputeLogSessionCreate = { name: params.name, lines: params.lines, tail: params.tail };
  try {
    return await connection.request<ComputeLogSession>({
      method: 'POST',
      url: '/connect/compute/logs/session',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    throw messages.createError('error.logSessionCreateFailed', [(err as Error).message]);
  }
}
