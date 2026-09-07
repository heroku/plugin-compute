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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import JSZip from 'jszip';
import type { Connection } from '@salesforce/core';
import { retrieveComputeMetadata } from '../../src/shared/metadataRetrieve.js';

async function zipBase64(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'base64' });
}

describe('metadataRetrieve.retrieveComputeMetadata', () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'plugin-compute-metaretrieve-'));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
    sinon.restore();
  });

  function stubConnection(retrieveResult: { success: boolean; errorMessage?: string; zipFile?: string }) {
    const complete = sinon.stub().resolves(retrieveResult);
    const retrieve = sinon.stub().returns({ complete });
    const connection = {
      getApiVersion: () => '62.0',
      metadata: { retrieve },
    } as unknown as Connection;
    return { connection, retrieve, complete };
  }

  it('requests a singlePackage unpackaged retrieve of the named PlatformComputeApp', async () => {
    const zipFile = await zipBase64({
      'compute/CreditRatingScorer/CreditRatingScorer.compute-meta.xml': '<PlatformComputeApp/>\n',
    });
    const { connection, retrieve } = stubConnection({ success: true, zipFile });

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(retrieve.calledOnce).to.be.true;
    const [request] = retrieve.firstCall.args as [
      { apiVersion: number; singlePackage: boolean; unpackaged: { types: Array<{ members: string[]; name: string }> } }
    ];
    expect(request.singlePackage).to.be.true;
    expect(request.unpackaged.types).to.deep.equal([{ members: ['CreditRatingScorer'], name: 'PlatformComputeApp' }]);
  });

  // Locks in the retrieve-vs-deploy asymmetry: RetrieveResultLocator#complete() takes no
  // argument, unlike DeployResultLocator#complete(includeDetails?).
  it('calls complete() with no arguments', async () => {
    const zipFile = await zipBase64({
      'compute/CreditRatingScorer/CreditRatingScorer.compute-meta.xml': '<PlatformComputeApp/>\n',
    });
    const { connection, complete } = stubConnection({ success: true, zipFile });

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(complete.calledOnceWithExactly()).to.be.true;
  });

  it('writes the retrieved compute-meta.xml into appDir', async () => {
    const zipFile = await zipBase64({
      'compute/CreditRatingScorer/CreditRatingScorer.compute-meta.xml':
        '<PlatformComputeApp><label>x</label></PlatformComputeApp>\n',
    });
    const { connection } = stubConnection({ success: true, zipFile });

    await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const written = await readFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), 'utf8');
    expect(written).to.equal('<PlatformComputeApp><label>x</label></PlatformComputeApp>\n');
  });

  it('throws with the errorMessage detail when the retrieve fails', async () => {
    const { connection } = stubConnection({ success: false, errorMessage: 'No such app' });

    try {
      await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
      expect((e as Error).message).to.include('No such app');
    }
  });

  it('throws when the retrieved zip is missing the expected compute-meta.xml entry', async () => {
    const zipFile = await zipBase64({ 'compute/CreditRatingScorer/unrelated.txt': 'oops' });
    const { connection } = stubConnection({ success: true, zipFile });

    try {
      await retrieveComputeMetadata(connection, appDir, 'CreditRatingScorer');
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer.compute-meta.xml');
    }
  });
});
