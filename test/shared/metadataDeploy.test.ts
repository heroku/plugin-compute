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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import type { Connection } from '@salesforce/core';
import JSZip from 'jszip';
import { deployComputeMetadata } from '../../src/shared/metadataDeploy.js';

describe('metadataDeploy.deployComputeMetadata', () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'plugin-compute-metadeploy-'));
    await writeFile(join(appDir, 'LeaseAgreementParser.compute-meta.xml'), '<PlatformComputeApp/>\n');
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
    sinon.restore();
  });

  function stubConnection(deployResult: {
    success: boolean;
    details: { componentFailures: Array<{ problem?: string }> };
  }) {
    const complete = sinon.stub().resolves(deployResult);
    const deploy = sinon.stub().returns({ complete });
    const connection = {
      getApiVersion: () => '62.0',
      metadata: { deploy },
    } as unknown as Connection;
    return { connection, deploy, complete };
  }

  it('builds a package.xml + compute/<name>/<name>.compute-meta.xml zip and deploys it', async () => {
    const { connection, deploy, complete } = stubConnection({ success: true, details: { componentFailures: [] } });

    await deployComputeMetadata(connection, appDir, 'LeaseAgreementParser');

    expect(deploy.calledOnce).to.be.true;
    const [zipBuffer, options] = deploy.firstCall.args as [Buffer, { singlePackage: boolean }];
    expect(options).to.deep.equal({ singlePackage: true });

    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).to.include('<members>LeaseAgreementParser</members>');
    expect(packageXml).to.include('<name>PlatformComputeApp</name>');

    const metaXml = await zip
      .file('compute/LeaseAgreementParser/LeaseAgreementParser.compute-meta.xml')
      ?.async('string');
    expect(metaXml).to.equal('<PlatformComputeApp/>\n');

    expect(complete.calledOnceWith(true)).to.be.true;
  });

  it('throws with the component failure detail when the deploy fails', async () => {
    const { connection } = stubConnection({
      success: false,
      details: { componentFailures: [{ problem: 'Invalid metadata type PlatformComputeApp' }] },
    });

    try {
      await deployComputeMetadata(connection, appDir, 'LeaseAgreementParser');
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('LeaseAgreementParser');
      expect((e as Error).message).to.include('Invalid metadata type PlatformComputeApp');
    }
  });
});
