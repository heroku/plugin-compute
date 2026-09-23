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
  /** PlatformComputeApp Id or DeveloperName to download source for. */
  appIdOrName: string;
};

// Speculative resource -- see the Compute tag description in salesforce-connect-compute.yaml.
// The response body is the same binary deployment-bundle.tar.gz uploadComputeSource sends, so
// this must round-trip exact bytes. connection.request()'s default string decoding is UTF-8,
// which is lossy for arbitrary gzip bytes (any byte >0x7F gets re-encoded) -- passing
// { encoding: 'binary' } (Node's alias for latin1) as the second argument makes jsforce decode
// the response 1:1 into a string, which Buffer.from(str, 'binary') then turns back into the
// exact original bytes.
export async function downloadComputeSource(
  connection: Connection,
  params: DownloadComputeSourceParams
): Promise<Buffer> {
  try {
    const body = await connection.request<string>(
      { method: 'GET', url: `/connect/compute/${encodeURIComponent(params.appIdOrName)}/source` },
      { encoding: 'binary' }
    );
    return Buffer.from(body, 'binary');
  } catch (err) {
    throw messages.createError('error.sourceDownloadFailed', [(err as Error).message]);
  }
}
