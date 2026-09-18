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
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect } from 'chai';
import sinon from 'sinon';
import tarStream from 'tar-stream';
import JSZip from 'jszip';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { Org } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import Retrieve from '../../../../src/commands/compute/source/retrieve.js';

async function zipBase64(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'base64' });
}

async function tarGz(entries: ReadonlyArray<{ name: string; data: Buffer }>): Promise<Buffer> {
  const pack = tarStream.pack();
  await entries.reduce(
    (previous, { name, data }) =>
      previous.then(
        async () =>
          new Promise<void>((resolve, reject) => {
            pack.entry({ name, size: data.length }, data, (err) => (err ? reject(err) : resolve()));
          })
      ),
    Promise.resolve()
  );
  pack.finalize();

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pack.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
    pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on('error', reject);
  });
}

async function buildBundle(): Promise<Buffer> {
  const sourceTarGz = await tarGz([{ name: 'src/app.js', data: Buffer.from('console.log("hi");\n') }]);
  return tarGz([
    { name: 'api-spec.yaml', data: Buffer.from('openapi: 3.0.0\n') },
    { name: 'source.tar.gz', data: sourceTarGz },
  ]);
}

// The download call is the only one that goes through fakeConnectionRequest with a URL ending
// in /source -- Org.init()'s own Organization-lookup request rides the same stub, so filter
// rather than asserting on requestStub directly (mirrors deploy.test.ts's findUploadCall).
function findDownloadCall(stub: sinon.SinonStub): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => (call.args[0] as { url?: string } | undefined)?.url?.endsWith('/source'));
}

describe('compute source retrieve', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let projectDir: string;
  let originalCwd: string;
  let requestStub: sinon.SinonStub;
  let metadataRetrieveStub: sinon.SinonStub;
  let completeStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const zipFile = await zipBase64({
      'platformComputeApps/CreditRatingScorer.compute': '<PlatformComputeApp/>\n',
    });
    const bundle = await buildBundle();

    requestStub = sinon.stub().resolves(bundle.toString('binary'));
    $$.fakeConnectionRequest = requestStub;

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    completeStub = sinon.stub().resolves({ success: true, zipFile });
    metadataRetrieveStub = $$.SANDBOX.stub(connection.metadata, 'retrieve').returns({
      complete: completeStub,
    } as never);
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    originalCwd = process.cwd();
    projectDir = await mkdtemp(join(tmpdir(), 'plugin-compute-retrieve-'));
    await writeFile(
      join(projectDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );
    $$.localPathRetriever = async () => projectDir;
    $$.localPathRetrieverSync = () => projectDir;
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
    $$.restore();
  });

  it('creates the app directory, retrieves metadata, then downloads and extracts source', async () => {
    const result = await Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const relativeAppDir = join('force-app/main/default/platformComputeApps', 'CreditRatingScorer');
    const appDir = join(projectDir, relativeAppDir);
    expect(result).to.deep.equal({ name: 'CreditRatingScorer', path: relativeAppDir, files: 2 });

    expect(await readFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), 'utf8')).to.equal(
      '<PlatformComputeApp/>\n'
    );
    expect(await readFile(join(appDir, 'api-spec.yaml'), 'utf8')).to.equal('openapi: 3.0.0\n');
    expect(await readFile(join(appDir, 'src', 'app.js'), 'utf8')).to.equal('console.log("hi");\n');

    expect(metadataRetrieveStub.calledOnce).to.be.true;
    const downloadCall = findDownloadCall(requestStub);
    expect(downloadCall, 'expected a GET to /connect/compute/source').to.not.be.undefined;
    expect(metadataRetrieveStub.firstCall.calledBefore(downloadCall!)).to.be.true;

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Retrieving compute app CreditRatingScorer');
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

    expect(result.path).to.equal(join('custom/compute', 'CreditRatingScorer'));
    expect(await readFile(join(projectDir, 'custom/compute/CreditRatingScorer/api-spec.yaml'), 'utf8')).to.equal(
      'openapi: 3.0.0\n'
    );
  });

  it('rejects a name that would traverse outside the output directory, without calling any API', async () => {
    try {
      await Retrieve.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(metadataRetrieveStub.called).to.be.false;
    expect(findDownloadCall(requestStub)).to.be.undefined;
  });

  it('fails fast when the app directory already exists, without calling any API', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
    await mkdir(appDir, { recursive: true });

    try {
      await Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('already exists');
    }
    expect(metadataRetrieveStub.called).to.be.false;
    expect(findDownloadCall(requestStub)).to.be.undefined;
  });

  it('does not attempt the source download when the metadata retrieve fails', async () => {
    completeStub.resolves({ success: false, errorMessage: 'No such app' });

    try {
      await Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No such app');
    }
    expect(findDownloadCall(requestStub)).to.be.undefined;
  });

  // No automatic rollback on failure -- the directory (and whatever was already written into
  // it) is left in place, same as generate.ts/deploy.ts's own style elsewhere in this plugin.
  it('propagates a source download failure after a successful metadata retrieve, leaving the metadata file in place', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Retrieve.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('socket hang up');
    }

    expect(metadataRetrieveStub.calledOnce).to.be.true;
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
    expect(await readFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), 'utf8')).to.equal(
      '<PlatformComputeApp/>\n'
    );
  });
});
