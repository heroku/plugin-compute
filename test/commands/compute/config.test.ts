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

  it('rejects an invalid --name before calling the Connect API', async () => {
    try {
      await Config.run(['--name', 'my-heroku-style-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(findConfigVarsCall(requestStub)).to.be.undefined;
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
