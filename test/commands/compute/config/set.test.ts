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

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts (see config.test.ts/scale.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// set.ts makes two separate proxy calls (PATCH .../config-vars, then GET .../releases), plus
// Org.create()/getConnection() issues its own request through this same shared requestStub while
// resolving --target-org -- so routing must key off both the decoded target and the method.
function findConfigVarsCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => {
    const req = call.args[0] as { url?: string; method?: string } | undefined;
    if (!req?.url) {
      return false;
    }
    return proxyTarget(req.url).endsWith('/config-vars') && (!method || req.method === method);
  });
}

function findReleasesCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => {
    const req = call.args[0] as { url?: string; method?: string } | undefined;
    if (!req?.url) {
      return false;
    }
    return proxyTarget(req.url).endsWith('/releases') && (!method || req.method === method);
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

    // PATCH .../config-vars returns Heroku's raw (flat) updated ConfigVars map; the command
    // doesn't read it back into the result (it echoes `updates` instead), so its exact contents
    // only matter for tests that assert on it directly. GET .../releases is the second,
    // independent call set.ts makes to report a release number in its spinner/output.
    requestStub = sinon.stub().callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return { STRIPE_KEY: 'sk_live_xyz789' };
      }
      if (target.endsWith('/releases') && req.method === 'GET') {
        return [{ version: 11 }];
      }
      return {};
    });
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
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(patchCall, 'expected a PATCH proxied to Heroku config-vars').to.not.be.undefined;
    expect(proxyTarget((patchCall!.args[0] as { url: string }).url)).to.equal(
      'https://api.heroku.com/apps/CreditRatingScorer/config-vars'
    );
    expect(JSON.parse((patchCall!.args[0] as { body: string }).body)).to.deep.equal({
      STRIPE_KEY: 'sk_live_xyz789',
    });
    const releasesCall = findReleasesCall(requestStub, 'GET');
    expect(releasesCall, 'expected a GET proxied to Heroku releases').to.not.be.undefined;
  });

  it('echoes only the vars just set, in the order typed, not the full response map', async () => {
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
    const result = await ConfigSet.run(['FOO=', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.configVars).to.deep.equal({ FOO: '' });
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as { body: string }).body)).to.deep.equal({ FOO: '' });
  });

  it('preserves whitespace around the key and value verbatim, without trimming', async () => {
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
    const result = await ConfigSet.run([
      'FOO=1',
      'FOO=2',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).to.deep.equal({ FOO: '2' });
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as { body: string }).body)).to.deep.equal({ FOO: '2' });
  });

  it('omits release from the result when there are no releases yet', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return { FOO: 'bar' };
      }
      if (target.endsWith('/releases') && req.method === 'GET') {
        return [];
      }
      return {};
    });

    const result = await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', configVars: { FOO: 'bar' } });
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('omits release, but still succeeds, when the release lookup itself fails (best-effort)', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return { FOO: 'bar' };
      }
      if (target.endsWith('/releases') && req.method === 'GET') {
        throw new Error('socket hang up');
      }
      return {};
    });

    const result = await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', configVars: { FOO: 'bar' } });
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('rejects a token with no =, without calling the Heroku proxy', async () => {
    try {
      await ConfigSet.run(['FOO_BAR', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.equal('"FOO_BAR" is not a valid KEY=VALUE pair. Use FOO_BAR=value.');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('rejects when no pairs are given, without calling the Heroku proxy', async () => {
    try {
      await ConfigSet.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one config var, for example `STRIPE_KEY=sk_live_...`.');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed and prints no echo lines', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw new Error('socket hang up');
      }
      return {};
    });

    try {
      await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include(
        "Couldn't reach the Heroku Platform API through Salesforce: socket hang up"
      );
    }
    expect(sfCommandStubs.log.called).to.be.false;
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error('bad proxy_url'), { errorCode: 'HEROKU_PROXY_ERROR' });
      }
      return {};
    });

    try {
      await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
    }
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error("Couldn't find that app."), { data: { id: 'not_found' } });
      }
      return {};
    });

    try {
      await ConfigSet.run(['FOO=bar', '--name', 'missing-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('missing-app');
    }
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
      const patchCall = findConfigVarsCall(requestStub, 'PATCH');
      expect(proxyTarget((patchCall!.args[0] as { url: string }).url)).to.equal(
        'https://api.heroku.com/apps/CreditRatingScorer/config-vars'
      );
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
