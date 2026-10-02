import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx, stubSpinner} from '@salesforce/sf-plugins-core';
import {expect} from 'chai';
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
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sinon from 'sinon';

import ConfigUnset from '../../../../src/commands/compute/config/unset.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts (see config.test.ts/scale.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// unset.ts makes three separate proxy calls: GET .../config-vars (existence check), PATCH
// .../config-vars (the actual unset), then GET .../releases (release number lookup) -- plus
// Org.create()/getConnection() issues its own request through this same shared requestStub while
// resolving --target-org -- so routing must key off both the decoded target and the method.
function findConfigVarsCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find(call => {
    const req = call.args[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).endsWith('/config-vars') && (!method || req.method === method);
  });
}

function findReleasesCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find(call => {
    const req = call.args[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).endsWith('/releases') && (!method || req.method === method);
  });
}

const computeAppRecord = {
  CurrentBuild: null,
  Description: null,
  DeveloperName: 'CreditRatingScorer',
  ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
  ExternalServiceRegistration: null,
  Id: '0abEE0000004CqYYAU',
  MasterLabel: 'Credit Rating Scorer',
  Status: 'ACTIVE',
  StatusReason: null,
};

describe('compute config unset', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    toolingQueryStub.resolves({done: true, records: [computeAppRecord], totalSize: 1});
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = sinon.stub().callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info', STRIPE_KEY: 'sk_live_abc123'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {STRIPE_KEY: 'sk_live_abc123'};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [{version: 10}];
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

    expect(result).to.deep.equal({name: 'CreditRatingScorer', release: 10, unset: ['LOG_LEVEL']});
    const configVarsGetCall = findConfigVarsCall(requestStub, 'GET');
    expect(configVarsGetCall, 'expected a GET proxied to Heroku config-vars').to.not.be.undefined;
    expect(proxyTarget((configVarsGetCall!.args[0] as {url: string}).url)).to.equal(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
    );
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as {body: string}).body)).to.deep.equal({LOG_LEVEL: null});
    expect(spinnerStubs.start.firstCall.args[0]).to.equal('Unsetting LOG_LEVEL and restarting CreditRatingScorer');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done, v10');
    const releasesCall = findReleasesCall(requestStub, 'GET');
    expect(releasesCall, 'expected a GET proxied to Heroku releases').to.not.be.undefined;
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

    expect(result).to.deep.equal({name: 'CreditRatingScorer', release: 10, unset: ['STRIPE_KEY', 'LOG_LEVEL']});
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall!.args[0] as {body: string}).body)).to.deep.equal({
      LOG_LEVEL: null,
      STRIPE_KEY: null,
    });
    expect(spinnerStubs.start.firstCall.args[0]).to.equal(
      'Unsetting STRIPE_KEY, LOG_LEVEL and restarting CreditRatingScorer',
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
    } catch (error) {
      expect((error as Error).message).to.equal('CreditRatingScorer has no config var named "MISSING".');
    }

    expect(findConfigVarsCall(requestStub, 'PATCH')).to.be.undefined;
  });

  it('rejects when no keys are given, without calling the Heroku proxy', async () => {
    try {
      await ConfigUnset.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('Specify at least one config var to unset');
    }

    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  // Now that unset.ts always pre-flights a SOQL lookup by DeveloperName before proxying to
  // Heroku, --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected
  // by validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include("isn't valid");
    }

    expect(toolingQueryStub.called).to.be.false;
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.resolves({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include("doesn't have a Heroku app identifier yet");
    }

    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('omits release from the result when there are no releases yet', async () => {
    requestStub.callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [];
      }

      return {};
    });

    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({name: 'CreditRatingScorer', unset: ['LOG_LEVEL']});
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('omits release, but still succeeds, when the release lookup itself fails (best-effort)', async () => {
    requestStub.callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        throw new Error('socket hang up');
      }

      return {};
    });

    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({name: 'CreditRatingScorer', unset: ['LOG_LEVEL']});
    expect(result).to.not.have.property('release');
    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('done');
  });

  it('wraps an unrecognized proxy failure from the PATCH as error.herokuApiRequestFailed', async () => {
    requestStub.callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw new Error('socket hang up');
      }

      return {};
    });

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include(
        "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
      );
    }

    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('wraps a proxy-rejection failure from the PATCH as error.herokuProxyRequestFailed', async () => {
    requestStub.callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'});
      }

      return {};
    });

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
    }

    expect(spinnerStubs.stop.firstCall.args[0]).to.equal('failed');
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app on the existence-check GET', async () => {
    requestStub.callsFake(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        throw Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}});
      }

      return {};
    });

    try {
      await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('CreditRatingScorer');
    }
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).to.deep.equal({name: 'CreditRatingScorer', release: 10, unset: ['LOG_LEVEL']});
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const patchCall = findConfigVarsCall(requestStub, 'PATCH');
      expect(proxyTarget((patchCall!.args[0] as {url: string}).url)).to.equal(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
      );
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
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-unset-empty-'));
    process.chdir(tmp);
    try {
      await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include("Couldn't determine which compute app to use");
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }

    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });
});
