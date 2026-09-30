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
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
    sinon.restore();
  });

  function stubConnection(deployStatus: {
    success: boolean;
    details: { componentFailures: Array<{ problem?: string }> };
  }) {
    const deploy = sinon.stub().resolves({ id: 'deploy-job-id' });
    const checkDeployStatus = sinon.stub().resolves({ id: 'deploy-job-id', done: true, ...deployStatus });
    // SDR's MetadataTransfer.getConnection() unconditionally calls retrieveMaxApiVersion() before
    // every deploy, even though we never pass an `apiVersion` option -- so the "requested higher
    // than org allows" branch it feeds into never actually fires, but the call itself must resolve.
    const retrieveMaxApiVersion = sinon.stub().resolves('70.0');
    const connection = {
      getApiVersion: () => '62.0',
      getAuthInfoFields: () => ({ orgId: '00DEE0000000000EAA' }),
      retrieveMaxApiVersion,
      metadata: { deploy, checkDeployStatus },
    } as unknown as Connection;
    return { connection, deploy, checkDeployStatus, retrieveMaxApiVersion };
  }

  it('builds a package.xml + platformComputeApps/<name>.compute zip and deploys it', async () => {
    const { connection, deploy, checkDeployStatus } = stubConnection({
      success: true,
      details: { componentFailures: [] },
    });

    const result = await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(result).to.deep.equal({ id: 'deploy-job-id' });
    // isRestDeploy is false since we never set apiOptions.rest -- SDR polls via the SOAP checkDeployStatus signature.
    expect(checkDeployStatus.calledOnceWith('deploy-job-id', true, false)).to.be.true;

    expect(deploy.calledOnce).to.be.true;
    const [zipBuffer, options] = deploy.firstCall.args as [Buffer, Record<string, unknown>];
    // SDR merges our apiOptions with its own defaults and strips `rest` before calling connection.metadata.deploy.
    expect(options).to.deep.equal({
      rollbackOnError: true,
      ignoreWarnings: false,
      checkOnly: false,
      singlePackage: true,
    });

    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).to.include('<members>CreditRatingScorer</members>');
    expect(packageXml).to.include('<name>PlatformComputeApp</name>');

    const metaXml = await zip.file('platformComputeApps/CreditRatingScorer.compute')?.async('string');
    expect(metaXml).to.equal('<PlatformComputeApp/>\n');
  });

  // Regression guard: PlatformComputeApp was only registered as a metadata type in API 68.0.
  // Emitting a package.xml with a lower version (e.g. an org's negotiated default, or a lower
  // sourceApiVersion) makes the server fail to resolve the type before it even inspects the zip
  // contents -- surfacing as a misleading "was named in package.xml, but was not found in zipped
  // directory" error instead of an explicit unsupported-type error.
  it('floors the package.xml version at 68.0 even when the connection reports a lower API version', async () => {
    const { connection, deploy } = stubConnection({ success: true, details: { componentFailures: [] } });
    connection.getApiVersion = () => '62.0';

    await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const [zipBuffer] = deploy.firstCall.args as [Buffer];
    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).to.include('<version>68.0</version>');
  });

  it('uses the connection API version as-is when it is already at or above 68.0', async () => {
    const { connection, deploy } = stubConnection({ success: true, details: { componentFailures: [] } });
    connection.getApiVersion = () => '70.0';

    await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const [zipBuffer] = deploy.firstCall.args as [Buffer];
    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).to.include('<version>70.0</version>');
  });

  it('throws with the component failure detail when the deploy fails', async () => {
    const { connection } = stubConnection({
      success: false,
      details: { componentFailures: [{ problem: 'Invalid metadata type PlatformComputeApp' }] },
    });

    try {
      await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
      expect((e as Error).message).to.include('Invalid metadata type PlatformComputeApp');
    }
  });
});
