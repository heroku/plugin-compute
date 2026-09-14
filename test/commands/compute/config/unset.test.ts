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
import ConfigUnset from '../../../../src/commands/compute/config/unset.js';

// Unset issues a GET (existence check) then a PATCH to the identical URL, plus the
// Org.create()/getConnection() request that also flows through this same shared stub while
// resolving --target-org -- so, unlike scale.test.ts's findFormationCall, routing must key off
// method as well as URL substring.
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

describe('compute config unset', () => {
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

    requestStub = sinon.stub().callsFake(async (req: { method?: string; url?: string }) => {
      if (req.url?.endsWith('/config-vars') && req.method === 'GET') {
        return { STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' };
      }
      if (req.url?.endsWith('/config-vars') && req.method === 'PATCH') {
        return { configVars: { STRIPE_KEY: 'sk_live_abc123' }, release: 10 };
      }
      return {};
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
  });

  it('unsets a single key and reports the release version', async () => {
    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', unset: ['LOG_LEVEL'], release: 10 });
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as { body: string }).body)).to.deep.equal({ LOG_LEVEL: null });
    expect(spinnerStubs.start.firstCall.args[0]).to.equal('Unsetting LOG_LEVEL and restarting CreditRatingScorer');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done, v10');
  });

  it('joins multiple keys with a plain comma when unsetting more than one', async () => {
    const result = await ConfigUnset.run([
      'STRIPE_KEY',
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', unset: ['STRIPE_KEY', 'LOG_LEVEL'], release: 10 });
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as { body: string }).body)).to.deep.equal({
      STRIPE_KEY: null,
      LOG_LEVEL: null,
    });
    expect(spinnerStubs.start.firstCall.args[0]).to.equal(
      'Unsetting STRIPE_KEY, LOG_LEVEL and restarting CreditRatingScorer'
    );
  });

  it('lists a key requested twice only once, and does not error as a duplicate', async () => {
    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.unset).to.deep.equal(['LOG_LEVEL']);
  });

  it('errors on a key that was never set, without calling PATCH', async () => {
    try {
      await ConfigUnset.run(['MISSING', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.equal('CreditRatingScorer has no config var named "MISSING".');
    }
    expect(findConfigVarsCall(requestStub, 'PATCH')).to.be.undefined;
  });

  it('rejects when no keys are given, without calling the Connect API', async () => {
    try {
      await ConfigUnset.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one config var to unset');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  // --name is never joined into a filesystem path (unlike other commands' --name), so a
  // hyphenated value -- invalid as a DeveloperName, but a shape Heroku app Ids/names commonly
  // take -- must pass through untouched rather than being rejected by a path-traversal guard.
  it('passes a hyphenated --name through untouched to the Connect API call', async () => {
    await ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]);

    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(patchCall!.args[0]).to.have.property('url', '/connect/compute/my-heroku-style-app/config-vars');
  });

  it('omits release from the result when the Connect response has none', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      if (req.url?.endsWith('/config-vars') && req.method === 'GET') {
        return { LOG_LEVEL: 'info' };
      }
      return { configVars: {} };
    });

    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', unset: ['LOG_LEVEL'] });
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('wraps a PATCH failure as error.configVarsUpdateFailed', async () => {
    requestStub.callsFake(async (req: { method?: string; url?: string }) => {
      if (req.url?.endsWith('/config-vars') && req.method === 'GET') {
        return { LOG_LEVEL: 'info' };
      }
      throw new Error('socket hang up');
    });

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't update the compute app's config vars: socket hang up");
    }
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as { result: unknown };
    expect(jsonOutput.result).to.deep.equal({ name: 'CreditRatingScorer', unset: ['LOG_LEVEL'], release: 10 });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const patchCall = findConfigVarsCall(requestStub, 'PATCH');
      expect((patchCall!.args[0] as { url: string }).url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-unset-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-unset-empty-'));
    process.chdir(tmp);
    try {
      await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
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

describe('compute config unset with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let spinnerStubs: ReturnType<typeof stubSpinner>;
  let fetchStub: sinon.SinonStub;

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    process.env.HEROKU_API_TOKEN = 'shh-secret-token';
    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
    process.exitCode = 0;
    $$.restore();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('unsets via Heroku directly (GET then PATCH) and omits release, since Heroku returns none', async () => {
    fetchStub.onFirstCall().resolves(jsonResponse({ STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' }));
    fetchStub.onSecondCall().resolves(jsonResponse({ STRIPE_KEY: 'sk_live_abc123' }));

    const result = await ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-app', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'my-heroku-app', unset: ['LOG_LEVEL'] });
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
    const getRequest = fetchStub.firstCall.args[0] as Request;
    expect(getRequest.url).to.equal('https://api.heroku.com/apps/my-heroku-app/config-vars');
    expect(getRequest.method).to.equal('GET');
    const patchRequest = fetchStub.secondCall.args[0] as Request;
    expect(patchRequest.method).to.equal('PATCH');
    expect(await patchRequest.clone().json()).to.deep.equal({ LOG_LEVEL: null });
  });

  it('errors on a key that was never set, without issuing a PATCH', async () => {
    fetchStub.resolves(jsonResponse({ STRIPE_KEY: 'sk_live_abc123' }));

    try {
      await ConfigUnset.run(['MISSING', '--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.equal('my-heroku-app has no config var named "MISSING".');
    }
    expect(fetchStub.calledOnce).to.be.true;
  });

  it('surfaces error.herokuAuthFailed on a 401/403 from the existence-check GET, never leaking the token', async () => {
    fetchStub.resolves(new Response('forbidden', { status: 403 }));

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('rejected the request');
      expect((e as Error).message).to.not.include('shh-secret-token');
    }
  });

  it('surfaces error.herokuApiRequestFailed on any other Heroku failure from the PATCH', async () => {
    fetchStub.onFirstCall().resolves(jsonResponse({ LOG_LEVEL: 'info' }));
    fetchStub.onSecondCall().resolves(new Response('server error', { status: 500 }));

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't reach the Heroku Platform API");
    }
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });
});
