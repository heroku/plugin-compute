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
