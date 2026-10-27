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
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {deployComputeMetadata} from '../../src/shared/metadataDeploy.js';

describe('metadataDeploy.deployComputeMetadata', () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'plugin-compute-metadeploy-'));
    await writeFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), '<ComputeApp/>\n');
  });

  afterEach(async () => {
    await rm(appDir, {force: true, recursive: true});
    vi.restoreAllMocks();
  });

  function stubConnection(deployStatus: {
    details: {componentFailures: Array<{problem?: string}>};
    success: boolean;
  }) {
    const deploy = vi.fn().mockResolvedValue({id: 'deploy-job-id'});
    const checkDeployStatus = vi.fn().mockResolvedValue({done: true, id: 'deploy-job-id', ...deployStatus});
    // SDR's MetadataTransfer.getConnection() unconditionally calls retrieveMaxApiVersion() before
    // every deploy, even though we never pass an `apiVersion` option -- so the "requested higher
    // than org allows" branch it feeds into never actually fires, but the call itself must resolve.
    const retrieveMaxApiVersion = vi.fn().mockResolvedValue('70.0');
    const connection = {
      getApiVersion: () => '62.0',
      getAuthInfoFields: () => ({orgId: '00DEE0000000000EAA'}),
      metadata: {checkDeployStatus, deploy},
      retrieveMaxApiVersion,
    } as unknown as Connection;
    return {
      checkDeployStatus, connection, deploy, retrieveMaxApiVersion,
    };
  }

  it('builds a package.xml + computeApps/<name>.computeApp zip and deploys it', async () => {
    const {checkDeployStatus, connection, deploy} = stubConnection({
      details: {componentFailures: []},
      success: true,
    });

    const result = await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    expect(result).toEqual({id: 'deploy-job-id'});
    // isRestDeploy is false since we never set apiOptions.rest -- SDR polls via the SOAP checkDeployStatus signature.
    expect(checkDeployStatus).toHaveBeenCalledExactlyOnceWith('deploy-job-id', true, false);

    expect(deploy).toHaveBeenCalledOnce();
    const [zipBuffer, options] = deploy.mock.calls[0] as [Buffer, Record<string, unknown>];
    // SDR merges our apiOptions with its own defaults and strips `rest` before calling connection.metadata.deploy.
    expect(options).toEqual({
      checkOnly: false,
      ignoreWarnings: false,
      rollbackOnError: true,
      singlePackage: true,
    });

    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).toContain('<members>CreditRatingScorer</members>');
    expect(packageXml).toContain('<name>ComputeApp</name>');

    const metaXml = await zip.file('computeApps/CreditRatingScorer.computeApp')?.async('string');
    expect(metaXml).toBe('<ComputeApp/>\n');
  });

  // Regression guard: ComputeApp was only registered as a metadata type in API 68.0.
  // Emitting a package.xml with a lower version (e.g. an org's negotiated default, or a lower
  // sourceApiVersion) makes the server fail to resolve the type before it even inspects the zip
  // contents -- surfacing as a misleading "was named in package.xml, but was not found in zipped
  // directory" error instead of an explicit unsupported-type error.
  it('floors the package.xml version at 68.0 even when the connection reports a lower API version', async () => {
    const {connection, deploy} = stubConnection({details: {componentFailures: []}, success: true});
    connection.getApiVersion = () => '62.0';

    await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const [zipBuffer] = deploy.mock.calls[0] as [Buffer];
    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).toContain('<version>68.0</version>');
  });

  it('uses the connection API version as-is when it is already at or above 68.0', async () => {
    const {connection, deploy} = stubConnection({details: {componentFailures: []}, success: true});
    connection.getApiVersion = () => '70.0';

    await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');

    const [zipBuffer] = deploy.mock.calls[0] as [Buffer];
    const zip = await JSZip.loadAsync(zipBuffer);
    const packageXml = await zip.file('package.xml')?.async('string');
    expect(packageXml).toContain('<version>70.0</version>');
  });

  it('throws with the component failure detail when the deploy fails', async () => {
    const {connection} = stubConnection({
      details: {componentFailures: [{problem: 'Invalid metadata type ComputeApp'}]},
      success: false,
    });

    let error: Error | undefined;
    try {
      await deployComputeMetadata(connection, appDir, 'CreditRatingScorer');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('CreditRatingScorer');
    expect(error?.message).toContain('Invalid metadata type ComputeApp');
  });
});
