import type {Connection} from '@salesforce/core';

import JSZip from 'jszip';
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
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {retrieveComputeMetadata} from '../../src/shared/metadataRetrieve.js';

async function zipBase64(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({type: 'base64'});
}

describe('metadataRetrieve.retrieveComputeMetadata', () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'plugin-compute-metaretrieve-'));
  });

  afterEach(async () => {
    await rm(appDir, {force: true, recursive: true});
    vi.restoreAllMocks();
  });

  function stubConnection(retrieveResult: {errorMessage?: string; success: boolean; zipFile?: string}) {
    const complete = vi.fn().mockResolvedValue(retrieveResult);
    const retrieve = vi.fn().mockReturnValue({complete});
    const connection = {
      getApiVersion: () => '62.0',
      getUsername: () => 'user@example.com',
      metadata: {retrieve},
    } as unknown as Connection;
    return {complete, connection, retrieve};
  }

  it('requests a singlePackage unpackaged retrieve of the named ComputeApp', async () => {
    const zipFile = await zipBase64({
      'computeApps/CreditRatingScorer.computeApp': '<ComputeApp/>\n',
    });
    const {connection, retrieve} = stubConnection({success: true, zipFile});

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(retrieve).toHaveBeenCalledOnce();
    const [request] = retrieve.mock.calls[0] as [
      {apiVersion: number; singlePackage: boolean; unpackaged: {types: Array<{members: string[]; name: string}>}},
    ];
    expect(request.singlePackage).toBe(true);
    expect(request.unpackaged.types).toEqual([{members: ['CreditRatingScorer'], name: 'ComputeApp'}]);
  });

  // Locks in the retrieve-vs-deploy asymmetry: RetrieveResultLocator#complete() takes no
  // argument, unlike DeployResultLocator#complete(includeDetails?).
  it('calls complete() with no arguments', async () => {
    const zipFile = await zipBase64({
      'computeApps/CreditRatingScorer.computeApp': '<ComputeApp/>\n',
    });
    const {complete, connection} = stubConnection({success: true, zipFile});

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]).toEqual([]);
  });

  it('writes the retrieved computeApp-meta.xml into appDir', async () => {
    const zipFile = await zipBase64({
      'computeApps/CreditRatingScorer.computeApp': '<ComputeApp><label>x</label></ComputeApp>\n',
    });
    const {connection} = stubConnection({success: true, zipFile});

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const written = await readFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), 'utf8');
    expect(written).toBe('<ComputeApp><label>x</label></ComputeApp>\n');
  });

  // Regression guard: mirrors the same floor in metadataDeploy.test.ts -- ComputeApp
  // wasn't a resolvable metadata type before API 68.0.
  it('floors the retrieve request version at 68.0 even when the connection reports a lower API version', async () => {
    const zipFile = await zipBase64({
      'computeApps/CreditRatingScorer.computeApp': '<ComputeApp/>\n',
    });
    const {connection, retrieve} = stubConnection({success: true, zipFile});
    connection.getApiVersion = () => '62.0';

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const [request] = retrieve.mock.calls[0] as [{apiVersion: number; unpackaged: {version: string}}];
    expect(request.apiVersion).toBe(68);
    expect(request.unpackaged.version).toBe('68.0');
  });

  it('throws with the errorMessage detail when the retrieve fails', async () => {
    const {connection} = stubConnection({errorMessage: 'No such app', success: false});

    let error: Error | undefined;
    try {
      await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('CreditRatingScorer');
    expect(error?.message).toContain('No such app');
  });

  it('throws when the retrieved zip is missing the expected wire entry', async () => {
    const zipFile = await zipBase64({'computeApps/unrelated.txt': 'oops'});
    const {connection} = stubConnection({success: true, zipFile});

    let error: Error | undefined;
    try {
      await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('computeApps/CreditRatingScorer.computeApp');
  });
});
