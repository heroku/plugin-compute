import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import tarStream from 'tar-stream';

import Retrieve from '../../../../src/commands/compute/source/retrieve.js';

async function zipBase64(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({type: 'base64'});
}

async function tarGz(entries: ReadonlyArray<{data: Buffer; name: string}>): Promise<Buffer> {
  const pack = tarStream.pack();
  // Sequential promise chain (entries written one at a time, in order), awaited once.
  let previous = Promise.resolve();
  for (const {data, name} of entries) {
    previous = previous.then(
      async () =>
        new Promise<void>((resolve, reject) => {
          pack.entry({name, size: data.length}, data, err => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }),
    );
  }

  await previous;
  pack.finalize();

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pack.on('data', (chunk: unknown) => {
      chunks.push(chunk as Buffer);
    });
    pack.on('end', () => {
      resolve(gzipSync(Buffer.concat(chunks)));
    });
    pack.on('error', reject);
  });
}

// The download endpoint returns the flat source.tar.gz (api-spec.yaml inside), not the nested
// deployment bundle the upload sends.
async function buildBundle(): Promise<Buffer> {
  return tarGz([
    {data: Buffer.from('openapi: 3.0.0\n'), name: 'api-spec.yaml'},
    {data: Buffer.from('console.log("hi");\n'), name: 'src/app.js'},
  ]);
}

// The download call is the only one that goes through fakeConnectionRequest with a URL ending
// in /source -- Org.init()'s own Organization-lookup request rides the same stub, so filter
// rather than asserting on requestStub directly (mirrors deploy.test.ts's findUploadCall).
function findDownloadCallIndex(stub: Mock): number {
  return stub.mock.calls.findIndex(call => (call[0] as undefined | {url?: string})?.url?.endsWith('/source'));
}

function findDownloadCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls[findDownloadCallIndex(stub)] as undefined | unknown[];
}

describe('compute source retrieve', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let projectDir: string;
  let originalCwd: string;
  let requestStub: Mock;
  let metadataRetrieveStub: MockInstance;
  let completeStub: Mock;
  let connectionSpy: MockInstance;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const zipFile = await zipBase64({
      'computeApps/CreditRatingScorer.computeApp': '<ComputeApp/>\n',
    });
    const bundle = await buildBundle();

    requestStub = vi.fn().mockResolvedValue(bundle.toString('binary'));
    $$.fakeConnectionRequest = requestStub;

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    completeStub = vi.fn().mockResolvedValue({success: true, zipFile});
    metadataRetrieveStub = vi.spyOn(connection.metadata, 'retrieve');
    metadataRetrieveStub.mockReturnValue({
      complete: completeStub,
    });
    connectionSpy = vi.spyOn(Org.prototype, 'getConnection').mockReturnValue(connection);

    originalCwd = process.cwd();
    projectDir = await mkdtemp(join(tmpdir(), 'plugin-compute-retrieve-'));
    await writeFile(
      join(projectDir, 'sfdx-project.json'),
      JSON.stringify({packageDirectories: [{default: true, path: 'force-app'}]}),
    );
    $$.localPathRetriever = async () => projectDir;
    $$.localPathRetrieverSync = () => projectDir;
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, {force: true, recursive: true});
    $$.restore();
    vi.restoreAllMocks();
  });

  it('creates the app directory, retrieves metadata, then downloads and extracts source', async () => {
    const result = await Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--api-version', '70.0']);
    expect(connectionSpy).toHaveBeenCalledWith('70.0');

    const relativeAppDir = join('force-app/main/default/computeApps', 'CreditRatingScorer');
    const appDir = join(projectDir, relativeAppDir);
    expect(result).toEqual({files: 2, name: 'CreditRatingScorer', path: relativeAppDir});

    expect(await readFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), 'utf8')).toBe(
      '<ComputeApp/>\n',
    );
    expect(await readFile(join(appDir, 'api-spec.yaml'), 'utf8')).toBe('openapi: 3.0.0\n');
    expect(await readFile(join(appDir, 'src', 'app.js'), 'utf8')).toBe('console.log("hi");\n');

    expect(metadataRetrieveStub).toHaveBeenCalledOnce();
    const downloadCall = findDownloadCall(requestStub);
    expect(downloadCall, 'expected a GET to /connect/compute/source').toBeDefined();
    expect(metadataRetrieveStub.mock.invocationCallOrder[0]).toBeLessThan(
      requestStub.mock.invocationCallOrder[findDownloadCallIndex(requestStub)],
    );

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('Retrieving compute app CreditRatingScorer');
  });

  it('supports a custom --output-dir', async () => {
    const result = await Retrieve.run([
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
      '--output-dir',
      'custom/compute',
    ]);

    expect(result.path).toBe(join('custom/compute', 'CreditRatingScorer'));
    expect(await readFile(join(projectDir, 'custom/compute/CreditRatingScorer/api-spec.yaml'), 'utf8')).toBe(
      'openapi: 3.0.0\n',
    );
  });

  it('rejects a name that would traverse outside the output directory, without calling any API', async () => {
    await expect(Retrieve.run(['--name', '../evil', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(metadataRetrieveStub).not.toHaveBeenCalled();
    expect(findDownloadCall(requestStub)).toBeUndefined();
  });

  it('fails fast when the app directory already exists, without calling any API', async () => {
    const appDir = join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer');
    await mkdir(appDir, {recursive: true});

    await expect(Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('already exists');

    expect(metadataRetrieveStub).not.toHaveBeenCalled();
    expect(findDownloadCall(requestStub)).toBeUndefined();
  });

  it('does not attempt the source download when the metadata retrieve fails', async () => {
    completeStub.mockResolvedValue({errorMessage: 'No such app', success: false});

    await expect(Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('No such app');

    expect(findDownloadCall(requestStub)).toBeUndefined();
  });

  it('leaves no app directory behind when the metadata retrieve fails, so a retry is not blocked', async () => {
    completeStub.mockResolvedValue({errorMessage: 'No such app', success: false});

    await expect(Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('No such app');

    const appDir = join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer');
    await expect(stat(appDir)).rejects.toThrow();
  });

  // No automatic rollback on failure -- the directory (and whatever was already written into
  // it) is left in place, same as generate.ts/deploy.ts's own style elsewhere in this plugin.
  it('propagates a source download failure after a successful metadata retrieve, leaving the metadata file in place', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('socket hang up');

    expect(metadataRetrieveStub).toHaveBeenCalledOnce();
    const appDir = join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer');
    expect(await readFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), 'utf8')).toBe(
      '<ComputeApp/>\n',
    );
  });
});
