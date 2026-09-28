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
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import ConfigGet from '../../../../src/commands/compute/config/get.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts (see config.test.ts/scale.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Mirrors config.test.ts's findConfigVarsCall -- Org.create()/getConnection() issues its own
// request through the same shared requestStub while resolving --target-org.
function findConfigVarsCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => {
    const req = call.args[0] as { url?: string; method?: string } | undefined;
    if (!req?.url) {
      return false;
    }
    return proxyTarget(req.url).endsWith('/config-vars') && (!method || req.method === method);
  });
}

const computeAppRecord = {
  Id: '0abEE0000004CqYYAU',
  DeveloperName: 'CreditRatingScorer',
  MasterLabel: 'Credit Rating Scorer',
  Description: null,
  Status: 'ACTIVE',
  StatusReason: null,
  CurrentBuild: null,
  ExternalServiceRegistration: null,
  ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
};

describe('compute config get', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    toolingQueryStub.resolves({ totalSize: 1, records: [computeAppRecord], done: true });
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = sinon.stub().resolves({ STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
  });

  it('prints the bare value for a single key, with no KEY: prefix', async () => {
    const result = await ConfigGet.run([
      'STRIPE_KEY',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', values: { STRIPE_KEY: 'sk_live_abc123' } });
    expect(sfCommandStubs.log.args.flat()).to.deep.equal(['sk_live_abc123']);
  });

  it('prints KEY: value pairs, aligned, for more than one key', async () => {
    const result = await ConfigGet.run([
      'STRIPE_KEY',
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      values: { STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' },
    });
    expect(sfCommandStubs.log.args.flat()).to.deep.equal(['STRIPE_KEY:  sk_live_abc123', 'LOG_LEVEL:   info']);
  });

  it('prints one line for a key requested twice, deduping the JSON values too', async () => {
    const result = await ConfigGet.run([
      'STRIPE_KEY',
      'STRIPE_KEY',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', values: { STRIPE_KEY: 'sk_live_abc123' } });
    expect(sfCommandStubs.log.args.flat()).to.deep.equal(['sk_live_abc123']);
  });

  it('errors on the first missing key, in the order the keys were requested', async () => {
    try {
      await ConfigGet.run(['ZEBRA', 'ALPHA', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.equal('CreditRatingScorer has no config var named "ZEBRA".');
    }
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app', async () => {
    requestStub.rejects(Object.assign(new Error("Couldn't find that app."), { data: { id: 'not_found' } }));

    try {
      await ConfigGet.run(['STRIPE_KEY', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
    }
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.rejects(Object.assign(new Error('bad proxy_url'), { errorCode: 'HEROKU_PROXY_ERROR' }));

    try {
      await ConfigGet.run(['STRIPE_KEY', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
    }
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await ConfigGet.run(['STRIPE_KEY', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include(
        "Couldn't reach the Heroku Platform API through Salesforce: socket hang up"
      );
    }
  });

  it('rejects when no keys are given, without calling the Heroku proxy', async () => {
    try {
      await ConfigGet.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one config var to get');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  // Now that get.ts always pre-flights a SOQL lookup by DeveloperName before proxying to Heroku,
  // --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected by
  // validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    try {
      await ConfigGet.run(['STRIPE_KEY', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.resolves({
      totalSize: 1,
      records: [{ ...computeAppRecord, ExternalAppIdentifier: undefined }],
      done: true,
    });

    try {
      await ConfigGet.run(['STRIPE_KEY', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("doesn't have a Heroku app identifier yet");
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigGet.run(['STRIPE_KEY', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as { result: unknown };
    expect(jsonOutput.result).to.deep.equal({
      name: 'CreditRatingScorer',
      values: { STRIPE_KEY: 'sk_live_abc123' },
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigGet.run(['STRIPE_KEY', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const call = findConfigVarsCall(requestStub, 'GET');
      expect(proxyTarget((call!.args[0] as { url: string }).url)).to.equal(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars'
      );
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-get-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await ConfigGet.run(['STRIPE_KEY', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-get-empty-'));
    process.chdir(tmp);
    try {
      await ConfigGet.run(['STRIPE_KEY', '--target-org', testOrg.username]);
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
