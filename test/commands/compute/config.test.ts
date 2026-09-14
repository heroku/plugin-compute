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
import Config from '../../../src/commands/compute/config.js';

// Mirrors scale.test.ts's findFormationCall -- Org.create()/getConnection() issues its own
// request through the same shared requestStub while resolving --target-org.
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

describe('compute config', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = sinon.stub().resolves({
      STRIPE_KEY: 'sk_live_abc123',
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      LOG_LEVEL: 'info',
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
  });

  it('lists config vars sorted alphabetically, aligned to the widest key', async () => {
    const result = await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      configVars: {
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        LOG_LEVEL: 'info',
        STRIPE_KEY: 'sk_live_abc123',
      },
    });
    expect(sfCommandStubs.styledHeader.firstCall.args[0]).to.equal('CreditRatingScorer Config Vars');
    expect(sfCommandStubs.log.args.flat()).to.deep.equal([
      'DATABASE_URL:  postgres://user:pass@host:5432/db',
      'LOG_LEVEL:     info',
      'STRIPE_KEY:    sk_live_abc123',
    ]);
    const call = findConfigVarsCall(requestStub, 'GET');
    expect(call, 'expected a GET to /connect/compute/{app}/config-vars').to.not.be.undefined;
    expect((call!.args[0] as { url: string }).url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
  });

  it('prints only the header when there are no config vars', async () => {
    requestStub.resolves({});

    const result = await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', configVars: {} });
    expect(sfCommandStubs.log.called).to.be.false;
  });

  // --name is never joined into a filesystem path (unlike other commands' --name), so a
  // hyphenated value -- invalid as a DeveloperName, but a shape Heroku app Ids/names commonly
  // take -- must pass through untouched rather than being rejected by a path-traversal guard.
  it('passes a hyphenated --name through untouched to the Connect API call', async () => {
    await Config.run(['--name', 'my-heroku-style-app', '--target-org', testOrg.username]);

    const call = findConfigVarsCall(requestStub, 'GET');
    expect(call!.args[0]).to.have.property('url', '/connect/compute/my-heroku-style-app/config-vars');
  });

  it('wraps a Connect API failure as error.configVarsFetchFailed', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't fetch the compute app's config vars: socket hang up");
    }
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as { result: unknown };
    expect(jsonOutput.result).to.deep.equal({
      name: 'CreditRatingScorer',
      configVars: {
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        LOG_LEVEL: 'info',
        STRIPE_KEY: 'sk_live_abc123',
      },
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Config.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const call = findConfigVarsCall(requestStub, 'GET');
      expect((call!.args[0] as { url: string }).url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await Config.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-empty-'));
    process.chdir(tmp);
    try {
      await Config.run(['--target-org', testOrg.username]);
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

describe('compute config with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let requestStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    // Distinct from the Heroku config-vars call below so a stray Connect call is easy to notice.
    requestStub = sinon.stub().resolves({ 'connect-api-path-not-used': true });
    $$.fakeConnectionRequest = requestStub;

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

  it('fetches config vars via Heroku directly, using --name as the Heroku app Id/name, without calling Connect', async () => {
    fetchStub.resolves(jsonResponse({ STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' }));

    const result = await Config.run(['--name', 'my-heroku-app', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'my-heroku-app',
      configVars: { LOG_LEVEL: 'info', STRIPE_KEY: 'sk_live_abc123' },
    });
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
    const request = fetchStub.firstCall.args[0] as Request;
    expect(request.url).to.equal('https://api.heroku.com/apps/my-heroku-app/config-vars');
  });

  it('surfaces error.herokuAppNotFound on a 404', async () => {
    fetchStub.resolves(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));

    try {
      await Config.run(['--name', 'missing-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('missing-app');
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
  });

  it('surfaces error.herokuAuthFailed on a 401/403, never leaking the token', async () => {
    fetchStub.resolves(new Response('forbidden', { status: 403 }));

    try {
      await Config.run(['--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('rejected the request');
      expect((e as Error).message).to.not.include('shh-secret-token');
    }
  });

  it('surfaces error.herokuApiRequestFailed on any other Heroku failure', async () => {
    fetchStub.resolves(new Response('server error', { status: 500 }));

    try {
      await Config.run(['--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't reach the Heroku Platform API");
    }
  });
});
