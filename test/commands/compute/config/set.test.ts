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
import { expect } from 'chai';
import sinon from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { Org } from '@salesforce/core';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import ConfigSet from '../../../../src/commands/compute/config/set.js';

function findConfigVarsCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => {
    const req = call.args[0] as { url?: string; method?: string } | undefined;
    return Boolean(
      req?.url?.startsWith('/connect/compute/') &&
        req.url.endsWith('/config-vars') &&
        (!method || req.method === method)
    );
  });
}

describe('compute config set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;
  let requestStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = sinon.stub().resolves({ configVars: { STRIPE_KEY: 'sk_live_xyz789' }, release: 11 });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
  });

  it('sets a single config var and echoes it back, with the release version', async () => {
    const result = await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      configVars: { STRIPE_KEY: 'sk_live_xyz789' },
      release: 11,
    });
    expect(sfCommandStubs.log.args.flat()).to.deep.equal(['STRIPE_KEY=sk_live_xyz789']);
    expect(spinnerStubs.start.firstCall.args[0]).to.equal('Setting config vars and restarting CreditRatingScorer');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done, v11');
    const call = findConfigVarsCall(requestStub, 'PATCH');
    expect(call, 'expected a PATCH to /connect/compute/{app}/config-vars').to.not.be.undefined;
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ STRIPE_KEY: 'sk_live_xyz789' });
    expect(
      requestStub.getCalls().filter((c) => (c.args[0] as { url?: string })?.url?.endsWith('/config-vars'))
    ).to.have.length(1);
  });

  it('echoes only the vars just set, in the order typed, not the full response map', async () => {
    requestStub.resolves({
      configVars: { STRIPE_KEY: 'sk_live_xyz789', LOG_LEVEL: 'debug', UNRELATED: 'untouched' },
      release: 11,
    });

    const result = await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      'LOG_LEVEL=debug',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      configVars: { STRIPE_KEY: 'sk_live_xyz789', LOG_LEVEL: 'debug' },
      release: 11,
    });
    expect(sfCommandStubs.log.args.flat()).to.deep.equal(['STRIPE_KEY=sk_live_xyz789', 'LOG_LEVEL=debug']);
  });

  it('splits only on the first =, so a value containing = is preserved whole', async () => {
    requestStub.resolves({ configVars: { DB_URL: 'postgres://user:pass@host/db?ssl=true' } });

    const result = await ConfigSet.run([
      'DB_URL=postgres://user:pass@host/db?ssl=true',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).to.deep.equal({ DB_URL: 'postgres://user:pass@host/db?ssl=true' });
  });

  it('accepts an empty value after the =, setting the key to an empty string', async () => {
    requestStub.resolves({ configVars: { FOO: '' } });

    const result = await ConfigSet.run(['FOO=', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.configVars).to.deep.equal({ FOO: '' });
    const call = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ FOO: '' });
  });

  it('preserves whitespace around the key and value verbatim, without trimming', async () => {
    requestStub.resolves({ configVars: { ' FOO ': ' bar ' } });

    const result = await ConfigSet.run([
      ' FOO = bar ',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).to.deep.equal({ ' FOO ': ' bar ' });
  });

  it('last-write-wins when the same key is set twice in one invocation', async () => {
    requestStub.resolves({ configVars: { FOO: '2' } });

    const result = await ConfigSet.run([
      'FOO=1',
      'FOO=2',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).to.deep.equal({ FOO: '2' });
    const call = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ FOO: '2' });
  });

  it('omits release from the result when the Connect response has none', async () => {
    requestStub.resolves({ configVars: { FOO: 'bar' } });

    const result = await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', configVars: { FOO: 'bar' } });
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('rejects a token with no =, without calling the Connect API', async () => {
    try {
      await ConfigSet.run(['FOO_BAR', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.equal('"FOO_BAR" is not a valid KEY=VALUE pair. Use FOO_BAR=value.');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('rejects when no pairs are given, without calling the Connect API', async () => {
    try {
      await ConfigSet.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one config var, for example `STRIPE_KEY=sk_live_...`.');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('wraps a Connect API failure as error.configVarsUpdateFailed and prints no echo lines', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't update the compute app's config vars: socket hang up");
    }
    expect(sfCommandStubs.log.called).to.be.false;
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
      '--json',
    ]);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as { result: unknown };
    expect(jsonOutput.result).to.deep.equal({
      name: 'CreditRatingScorer',
      configVars: { STRIPE_KEY: 'sk_live_xyz789' },
      release: 11,
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const call = findConfigVarsCall(requestStub, 'PATCH');
      expect((call!.args[0] as { url: string }).url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-set-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-set-empty-'));
    process.chdir(tmp);
    try {
      await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't determine which compute app to use");
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });
});
