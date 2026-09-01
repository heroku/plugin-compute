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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect } from 'chai';
import sinon from 'sinon';
import tarStream from 'tar-stream';
import type FormData from 'form-data';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { Org, SfError } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import Deploy from '../../../src/commands/compute/deploy.js';

// Every Deploy.run() call resolves --target-org via Org.create(), which issues its own
// Organization-lookup request through the same shared requestStub -- so callCount/called
// assertions on requestStub itself are unreliable. Filter for the specific upload call instead.
function findUploadCall(stub: sinon.SinonStub): sinon.SinonSpyCall | undefined {
  return stub
    .getCalls()
    .find((call) => (call.args[0] as { url?: string } | undefined)?.url === '/connect/compute/source');
}

// The upload call's body is the FormData instance itself (request stubbed before serialization),
// so pull its rendered multipart buffer and slice out one field's raw bytes by hand. latin1
// round-trips 1 byte <-> 1 char losslessly, which keeps the gzip payload intact.
function extractMultipartField(form: FormData, fieldName: string): Buffer {
  const boundary = form.getBoundary();
  const text = form.getBuffer().toString('latin1');
  const parts = text.split(`--${boundary}`).slice(1, -1);
  const part = parts.find((p) => p.includes(`name="${fieldName}"`));
  if (!part) {
    throw new Error(`multipart field "${fieldName}" not found`);
  }
  const headerEnd = part.indexOf('\r\n\r\n');
  const body = part.slice(headerEnd + 4, -2);
  return Buffer.from(body, 'latin1');
}

async function extractTarGz(buffer: Buffer): Promise<Record<string, Buffer>> {
  const entries: Record<string, Buffer> = {};
  const extract = tarStream.extract();

  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
      stream.on('end', () => {
        entries[header.name] = Buffer.concat(chunks);
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    extract.end(gunzipSync(buffer));
  });

  return entries;
}

describe('compute deploy', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let projectDir: string;
  let originalCwd: string;
  let requestStub: sinon.SinonStub;
  let metadataDeployStub: sinon.SinonStub;
  let completeStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    // TestContext already wraps Connection.prototype.request and routes it through
    // $$.fakeConnectionRequest -- stubbing connection.request ourselves would double-wrap it.
    requestStub = sinon.stub().resolves({
      platformComputeId: '0abEE0000004CqYYAU',
      buildId: '0acEE0000004D1ZYAU',
      sourceBlobSize: 12,
      uploadedAt: '2026-08-31T00:00:00.000Z',
    });
    $$.fakeConnectionRequest = requestStub;

    // Org.init() calls getConnection().getAuthInfoFields() while resolving --target-org, and
    // connection.metadata is memoized per-connection-instance, so reuse one real Connection
    // (rather than a bare fake) across every getConnection() call in this test.
    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    completeStub = sinon.stub().resolves({ success: true, details: { componentFailures: [] } });
    metadataDeployStub = $$.SANDBOX.stub(connection.metadata, 'deploy').returns({ complete: completeStub } as never);
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    originalCwd = process.cwd();
    projectDir = await mkdtemp(join(tmpdir(), 'plugin-compute-deploy-'));
    await writeFile(
      join(projectDir, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] })
    );
    process.chdir(projectDir);

    // TestContext.inProject(true) stubs SfProject.resolveProjectPath to an internal sandbox
    // path unrelated to cwd. Override the retrievers (the supported hook) so this.project.getPath()
    // in deploy.ts matches the fixture directory we actually created above.
    $$.localPathRetriever = async () => projectDir;
    $$.localPathRetrieverSync = () => projectDir;

    const appDir = join(projectDir, 'force-app/main/default/compute/LeaseAgreementParser');
    await mkdir(join(appDir, 'src'), { recursive: true });
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'LeaseAgreementParser.compute-meta.xml'), '<PlatformComputeApp/>\n');
    await writeFile(join(appDir, 'project.toml'), '[_]\nschema-version = "0.2"\n');
    await writeFile(join(appDir, 'src', 'app.js'), 'console.log("hi");\n');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
    $$.restore();
  });

  it('uploads source before deploying metadata, and returns the build ids', async () => {
    const result = await Deploy.run(['--name', 'LeaseAgreementParser', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'LeaseAgreementParser',
      platformComputeId: '0abEE0000004CqYYAU',
      buildId: '0acEE0000004D1ZYAU',
    });
    const uploadCall = findUploadCall(requestStub);
    expect(uploadCall, 'expected a POST to /connect/compute/source').to.not.be.undefined;
    expect(metadataDeployStub.calledOnce).to.be.true;
    // Upload (Connect API) must complete before the metadata deploy (the actual build trigger) starts.
    expect(uploadCall!.calledBefore(metadataDeployStub.firstCall)).to.be.true;
    expect(completeStub.calledOnceWith(true)).to.be.true;

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('packaging source');
  });

  it('excludes files matching the project-root .forceignore from the uploaded bundle', async () => {
    const appDir = join(projectDir, 'force-app/main/default/compute/LeaseAgreementParser');
    await writeFile(join(appDir, 'src', 'secret.pem'), 'private key\n');
    await writeFile(join(projectDir, '.forceignore'), '*.pem\n');

    await Deploy.run(['--name', 'LeaseAgreementParser', '--target-org', testOrg.username]);

    const uploadCall = findUploadCall(requestStub);
    const form = uploadCall!.args[0] as { body: FormData };
    const bundleBuffer = extractMultipartField(form.body, 'bundle');
    const outer = await extractTarGz(bundleBuffer);
    const source = await extractTarGz(outer['source.tar.gz']);

    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('does not attempt the metadata deploy when the source upload fails', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Deploy.run(['--name', 'LeaseAgreementParser', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('socket hang up');
    }

    expect(metadataDeployStub.called).to.be.false;
  });

  it('propagates the metadata deploy failure after a successful upload', async () => {
    completeStub.resolves({
      success: false,
      details: { componentFailures: [{ problem: 'Invalid metadata type PlatformComputeApp' }] },
    });

    try {
      await Deploy.run(['--name', 'LeaseAgreementParser', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Invalid metadata type PlatformComputeApp');
    }

    expect(findUploadCall(requestStub)).to.not.be.undefined;
  });

  it('fails fast when the app directory does not exist', async () => {
    try {
      await Deploy.run(['--name', 'DoesNotExist', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No compute app named DoesNotExist');
      // Regression check for the actionTokens bug: the --name %s placeholder in
      // error.appNotFound.actions must be filled in, not left as a literal %s.
      const actions = (e as SfError).actions ?? [];
      expect(actions.join('\n')).to.include('compute generate --name DoesNotExist');
      expect(actions.join('\n')).to.not.include('%s');
    }
    expect(findUploadCall(requestStub)).to.be.undefined;
  });

  it('fails fast when the app has no Procfile', async () => {
    const appDir = join(projectDir, 'force-app/main/default/compute/NoProcfile');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'NoProcfile.compute-meta.xml'), '<PlatformComputeApp/>\n');

    try {
      await Deploy.run(['--name', 'NoProcfile', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('no Procfile');
    }
    expect(findUploadCall(requestStub)).to.be.undefined;
  });

  it('fails fast when the app has no api-spec.yaml', async () => {
    const appDir = join(projectDir, 'force-app/main/default/compute/NoApiSpec');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'NoApiSpec.compute-meta.xml'), '<PlatformComputeApp/>\n');

    try {
      await Deploy.run(['--name', 'NoApiSpec', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('no api-spec.yaml');
    }
    expect(findUploadCall(requestStub)).to.be.undefined;
  });

  it('rejects a name that would traverse outside the output directory', async () => {
    try {
      await Deploy.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(findUploadCall(requestStub)).to.be.undefined;
  });
});
