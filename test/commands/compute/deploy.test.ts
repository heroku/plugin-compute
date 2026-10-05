import type FormData from 'form-data';
import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import tarStream from 'tar-stream';

import Deploy from '../../../src/commands/compute/deploy.js';

// Every Deploy.run() call resolves --target-org via Org.create(), which issues its own
// Organization-lookup request through the same shared requestStub -- so callCount/called
// assertions on requestStub itself are unreliable. Filter for the specific upload call instead.
function findUploadCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls.find(call => (call[0] as undefined | {url?: string})?.url === '/connect/compute/source');
}

// The upload call's body is the FormData instance itself (request stubbed before serialization),
// so pull its rendered multipart buffer and slice out one field's raw bytes by hand. latin1
// round-trips 1 byte <-> 1 char losslessly, which keeps the gzip payload intact.
function extractMultipartField(form: FormData, fieldName: string): Buffer {
  const boundary = form.getBoundary();
  const text = form.getBuffer().toString('latin1');
  const parts = text.split(`--${boundary}`).slice(1, -1);
  const part = parts.find(p => p.includes(`name="${fieldName}"`));
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
      stream.on('data', (chunk: unknown) => {
        chunks.push(chunk as Buffer);
      });
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
  let requestStub: Mock;
  let metadataDeployStub: MockInstance;
  let checkDeployStatusStub: MockInstance;

  const deployId = '0Af9E00000123ABCAA';

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    // TestContext already wraps Connection.prototype.request and routes it through
    // $$.fakeConnectionRequest -- stubbing connection.request ourselves would double-wrap it.
    requestStub = vi.fn().mockResolvedValue({
      buildId: '0acEE0000004D1ZYAU',
      platformComputeId: '0abEE0000004CqYYAU',
      sourceBlobSize: 12,
      uploadedAt: '2026-08-31T00:00:00.000Z',
    });
    $$.fakeConnectionRequest = requestStub;

    // Org.init() calls getConnection().getAuthInfoFields() while resolving --target-org, and
    // connection.metadata is memoized per-connection-instance, so reuse one real Connection
    // (rather than a bare fake) across every getConnection() call in this test.
    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    metadataDeployStub = vi.spyOn(connection.metadata, 'deploy').mockResolvedValue({id: deployId} as never);
    checkDeployStatusStub = vi.spyOn(connection.metadata, 'checkDeployStatus').mockResolvedValue({
      details: {componentFailures: []},
      done: true,
      id: deployId,
      success: true,
    } as never);
    // SDR's MetadataTransfer.getConnection() unconditionally calls this before every deploy.
    $$.SANDBOX.stub(connection, 'retrieveMaxApiVersion').resolves('70.0');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    originalCwd = process.cwd();
    // realpath: tmpdir() is a /var symlink on macOS, but process.chdir() makes cwd (hence deploy's
    // appDir) the canonical /private/var form -- the project root must match, or relative(root, appDir)
    // in computeBundle escapes with ../ and the `ignore` lib rejects it.
    const tempRoot = await mkdtemp(join(tmpdir(), 'plugin-compute-deploy-'));
    projectDir = await realpath(tempRoot);
    await writeFile(
      join(projectDir, 'sfdx-project.json'),
      JSON.stringify({packageDirectories: [{default: true, path: 'force-app'}]}),
    );

    // TestContext.inProject(true) stubs SfProject.resolveProjectPath to an internal sandbox
    // path unrelated to cwd. Override the retrievers (the supported hook) so this.project.getPath()
    // in deploy.ts matches the fixture directory we actually created above, independent of cwd.
    $$.localPathRetriever = async () => projectDir;
    $$.localPathRetrieverSync = () => projectDir;

    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
    await mkdir(join(appDir, 'src'), {recursive: true});
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    await writeFile(join(appDir, 'project.toml'), '[_]\nschema-version = "0.2"\n');
    await writeFile(join(appDir, 'src', 'app.js'), 'console.log("hi");\n');

    // deploy.ts derives the app name from basename(cwd) -- run from inside the app's own directory.
    process.chdir(appDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, {force: true, recursive: true});
    $$.restore();
    vi.restoreAllMocks();
  });

  it('uploads source before deploying metadata, and returns the build ids', async () => {
    const result = await Deploy.run(['--target-org', testOrg.username]);

    expect(result).toEqual({
      buildId: '0acEE0000004D1ZYAU',
      deployId,
      name: 'CreditRatingScorer',
      platformComputeId: '0abEE0000004CqYYAU',
    });
    const uploadCall = findUploadCall(requestStub);
    expect(uploadCall, 'expected a POST to /connect/compute/source').toBeDefined();
    expect(metadataDeployStub).toHaveBeenCalledOnce();
    // Upload (Connect API) must complete before the metadata deploy (the actual build trigger) starts.
    const uploadIndex = requestStub.mock.calls.indexOf(uploadCall!);
    expect(requestStub.mock.invocationCallOrder[uploadIndex]).toBeLessThan(metadataDeployStub.mock.invocationCallOrder[0]);
    expect(checkDeployStatusStub).toHaveBeenCalledExactlyOnceWith(deployId, true, false);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('packaging source');
  });

  it('excludes files matching the project-root .forceignore from the uploaded bundle', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
    await writeFile(join(appDir, 'src', 'secret.pem'), 'private key\n');
    await writeFile(join(projectDir, '.forceignore'), '*.pem\n');

    await Deploy.run(['--target-org', testOrg.username]);

    const uploadCall = findUploadCall(requestStub);
    const form = uploadCall![0] as {body: FormData};
    const bundleBuffer = extractMultipartField(form.body, 'bundle');
    const outer = await extractTarGz(bundleBuffer);
    const source = await extractTarGz(outer['source.tar.gz']);

    expect(Object.keys(source).toSorted()).toEqual(['Procfile', 'src/app.js']);
  });

  it('does not attempt the metadata deploy when the source upload fails', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow('socket hang up');

    expect(metadataDeployStub).not.toHaveBeenCalled();
  });

  it('propagates the metadata deploy failure after a successful upload', async () => {
    checkDeployStatusStub.mockResolvedValue({
      details: {componentFailures: [{problem: 'Invalid metadata type PlatformComputeApp'}]},
      done: true,
      id: deployId,
      success: false,
    });

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow('Invalid metadata type PlatformComputeApp');

    expect(findUploadCall(requestStub)).toBeDefined();
  });

  it('fails fast when the current directory has no <name>.compute-meta.xml', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/NotScaffolded');
    await mkdir(appDir, {recursive: true});
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    process.chdir(appDir);

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow('NotScaffolded.compute-meta.xml');

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it('reports the missing compute-meta.xml before checking whether the directory name is valid', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/Not-Valid');
    await mkdir(appDir, {recursive: true});
    process.chdir(appDir);

    let error: Error | undefined;
    try {
      await Deploy.run(['--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('Not-Valid.compute-meta.xml');
    expect(error?.message).not.toContain("isn't valid");

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it('fails fast when the app has no Procfile', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/NoProcfile');
    await mkdir(appDir, {recursive: true});
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'NoProcfile.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow('no Procfile');

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it('fails fast when the app has no api-spec.yaml', async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/NoApiSpec');
    await mkdir(appDir, {recursive: true});
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'NoApiSpec.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow('no api-spec.yaml');

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it("rejects a directory name that isn't a valid compute app name", async () => {
    const appDir = join(projectDir, 'force-app/main/default/platformComputeApps/Not-Valid');
    await mkdir(appDir, {recursive: true});
    await writeFile(join(appDir, 'Not-Valid.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);

    await expect(Deploy.run(['--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it('deploys from --source-dir without needing to chdir into the app directory', async () => {
    process.chdir(projectDir);

    const result = await Deploy.run([
      '--source-dir',
      'force-app/main/default/platformComputeApps/CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({
      buildId: '0acEE0000004D1ZYAU',
      deployId,
      name: 'CreditRatingScorer',
      platformComputeId: '0abEE0000004CqYYAU',
    });
    expect(findUploadCall(requestStub)).toBeDefined();
  });

  it('resolves a relative --source-dir to an absolute path before deriving the app name', async () => {
    process.chdir(join(projectDir, 'force-app/main/default/platformComputeApps'));

    const result = await Deploy.run(['--source-dir', './CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.name).toBe('CreditRatingScorer');
  });

  it('rejects --source-dir when it has no <name>.compute-meta.xml, without falling back to cwd', async () => {
    const notScaffolded = join(projectDir, 'force-app/main/default/platformComputeApps/NotScaffolded');
    await mkdir(notScaffolded, {recursive: true});
    process.chdir(projectDir);

    await expect(Deploy.run([
      '--source-dir',
      'force-app/main/default/platformComputeApps/NotScaffolded',
      '--target-org',
      testOrg.username,
    ])).rejects.toThrow('NotScaffolded.compute-meta.xml');

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  it('rejects a --source-dir that does not exist', async () => {
    process.chdir(projectDir);

    await expect(Deploy.run([
      '--source-dir',
      'force-app/main/default/platformComputeApps/DoesNotExist',
      '--target-org',
      testOrg.username,
    ])).rejects.toThrow('No directory found');

    expect(findUploadCall(requestStub)).toBeUndefined();
  });

  // Guards against the exact regression a plain `default: process.cwd()` would reintroduce --
  // that value is captured once at class-definition time, so every run() after the first would
  // keep resolving whichever cwd was current when the class first loaded, not the cwd at parse
  // time. Two Deploy.run() calls from two different cwds, neither passing --source-dir, must each
  // resolve their own app name.
  it("re-evaluates --source-dir's default per invocation rather than once at class load", async () => {
    const otherAppDir = join(projectDir, 'force-app/main/default/platformComputeApps/OtherApp');
    await mkdir(join(otherAppDir, 'src'), {recursive: true});
    await writeFile(join(otherAppDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(otherAppDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(otherAppDir, 'OtherApp.compute-meta.xml'), '<PlatformComputeApp/>\n');
    await writeFile(join(otherAppDir, 'src', 'app.js'), 'console.log("hi");\n');

    const first = await Deploy.run(['--target-org', testOrg.username]);
    expect(first.name).toBe('CreditRatingScorer');

    process.chdir(otherAppDir);
    const second = await Deploy.run(['--target-org', testOrg.username]);
    expect(second.name).toBe('OtherApp');
  });
});
