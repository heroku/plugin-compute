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
import Output from '../../../../src/commands/compute/build/output.js';

// jsforce's HttpApi.getError() sets both .name and .errorCode to the parsed error body's
// errorCode, falling back to `ERROR_HTTP_${status}` when the body isn't a recognizable
// { message, errorCode } shape -- this is the exact shape a 404 with no body takes.
function httpError(status: number, message = 'Not Found'): Error {
  return Object.assign(new Error(message), { name: `ERROR_HTTP_${status}`, errorCode: `ERROR_HTTP_${status}` });
}

// Org.create()/getConnection() issues its own Organization-lookup request through the same
// shared requestStub while resolving --target-org, so callCount/called on the stub itself is
// unreliable -- filter for the specific build-output call instead (mirrors deploy.test.ts).
function findBuildOutputCall(stub: sinon.SinonStub): sinon.SinonSpyCall | undefined {
  return stub
    .getCalls()
    .find((call) => (call.args[0] as { url?: string } | undefined)?.url?.includes('/connect/compute/build/output'));
}

describe('compute build output', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;

  const buildingRecord = {
    Id: '0abEE0000004CqYYAU',
    DeveloperName: 'CreditRatingScorer',
    MasterLabel: 'Credit Rating Scorer',
    Description: null,
    Status: 'DEPLOYING',
    StatusReason: null,
    CurrentBuild: {
      Id: '0acEE0000004D1ZYAU',
      BuildStatus: 'BUILDING',
      BuildStartedAt: '2026-08-31T14:23:50.000Z',
      BuildCompletedAt: null,
      DeployedAt: null,
      DeployedBy: null,
      Error: null,
    },
    ExternalServiceRegistration: null,
  };

  const succeededRecord = {
    ...buildingRecord,
    Status: 'ACTIVE',
    CurrentBuild: {
      ...buildingRecord.CurrentBuild,
      BuildStatus: 'SUCCEEDED',
      BuildCompletedAt: '2026-08-31T14:25:32.000Z',
      DeployedAt: '2026-08-31T14:25:32.000Z',
      DeployedBy: { Username: 'dev@mycompany.com' },
    },
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = sinon.stub().resolves('-----> Building on the Heroku-24 stack\nBuild succeeded!\n');
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    $$.restore();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.resolves({ totalSize: records.length, records, done: true });
  }

  it('prints the log and returns name, buildStatus, and log on the happy path', async () => {
    resolveWith([succeededRecord]);

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      buildStatus: 'SUCCEEDED',
      log: '-----> Building on the Heroku-24 stack\nBuild succeeded!\n',
    });
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Build succeeded!');

    const call = findBuildOutputCall(requestStub);
    expect(call, 'expected a GET to /connect/compute/build/output').to.not.be.undefined;
    expect((call!.args[0] as { url: string }).url).to.include('name=CreditRatingScorer');
  });

  it('reports no builds yet and returns just the name when CurrentBuild is null', async () => {
    resolveWith([{ ...buildingRecord, CurrentBuild: null }]);

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
    expect(sfCommandStubs.info.firstCall.args[0]).to.include('has no builds yet');
    expect(findBuildOutputCall(requestStub)).to.be.undefined;
  });

  it('reports not-yet-available and returns buildStatus without log when the Connect endpoint 404s', async () => {
    resolveWith([buildingRecord]);
    requestStub.rejects(httpError(404));

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', buildStatus: 'BUILDING' });
    expect(sfCommandStubs.info.firstCall.args[0]).to.include("hasn't produced output yet");
    expect(sfCommandStubs.log.called).to.be.false;
  });

  it('propagates the not-found error from the SOQL pre-check without calling the Connect endpoint', async () => {
    resolveWith([]);

    try {
      await Output.run(['--name', 'NeverDeployed', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No compute app named NeverDeployed was found in the org');
    }
    expect(findBuildOutputCall(requestStub)).to.be.undefined;
  });

  it('propagates the ambiguous-name error from the SOQL pre-check without calling the Connect endpoint', async () => {
    resolveWith([buildingRecord, buildingRecord]);

    try {
      await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Found more than one compute app named CreditRatingScorer');
    }
    expect(findBuildOutputCall(requestStub)).to.be.undefined;
  });

  it('wraps a genuine transport failure distinctly from the not-yet-available 404 case', async () => {
    resolveWith([buildingRecord]);
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't fetch build output: socket hang up");
    }
  });

  it('still logs and returns an empty-string build log rather than treating it as not-yet-available', async () => {
    resolveWith([succeededRecord]);
    requestStub.resolves('');

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', buildStatus: 'SUCCEEDED', log: '' });
  });

  it('drops undefined keys under --json for the no-builds-yet case', async () => {
    resolveWith([{ ...buildingRecord, CurrentBuild: null }]);

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).to.not.include('buildStatus');
    expect(JSON.stringify(jsonOutput)).to.not.include('"log"');
    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
  });

  it('preserves the exact case of --name in both the SOQL filter and the Connect API query param', async () => {
    resolveWith([succeededRecord]);

    await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    const call = findBuildOutputCall(requestStub);
    expect((call!.args[0] as { url: string }).url).to.include('name=CreditRatingScorer');
  });

  it('rejects an invalid --name before querying or calling the Connect endpoint', async () => {
    try {
      await Output.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
    expect(findBuildOutputCall(requestStub)).to.be.undefined;
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([succeededRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Output.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const soql: string = toolingQueryStub.firstCall.args[0];
      expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
      const call = findBuildOutputCall(requestStub);
      expect((call!.args[0] as { url: string }).url).to.include('name=CreditRatingScorer');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([succeededRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-build-output-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await Output.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-build-output-empty-'));
    process.chdir(tmp);
    try {
      await Output.run(['--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't determine which compute app to use");
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
    expect(toolingQueryStub.called).to.be.false;
  });
});

describe('compute build output with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  const succeededRecord = {
    Id: '0abEE0000004CqYYAU',
    DeveloperName: 'CreditRatingScorer',
    MasterLabel: 'Credit Rating Scorer',
    Description: null,
    Status: 'ACTIVE',
    StatusReason: null,
    CurrentBuild: {
      Id: '0acEE0000004D1ZYAU',
      BuildStatus: 'SUCCEEDED',
      BuildStartedAt: '2026-08-31T14:23:50.000Z',
      BuildCompletedAt: '2026-08-31T14:25:32.000Z',
      DeployedAt: '2026-08-31T14:25:32.000Z',
      DeployedBy: { Username: 'dev@mycompany.com' },
      Error: null,
    },
    ExternalServiceRegistration: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
    toolingQueryStub.resolves({ totalSize: 1, records: [succeededRecord], done: true });

    requestStub = sinon.stub();
    $$.fakeConnectionRequest = requestStub;

    process.env.HEROKU_API_TOKEN = 'shh-secret-token';
    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
    $$.restore();
  });

  it('fetches build output from Heroku directly instead of the Connect API', async () => {
    fetchStub.callsFake(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/builds')) {
        return new Response(
          // eslint-disable-next-line camelcase -- output_stream_url is Heroku's Build field name
          JSON.stringify([{ id: 'b1', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b1' }]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('-----> Build succeeded!\n', { status: 200 });
    });

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      buildStatus: 'SUCCEEDED',
      log: '-----> Build succeeded!\n',
    });
    expect(findBuildOutputCall(requestStub)).to.be.undefined;
  });

  it('surfaces a hard herokuAppNotFound error when Heroku 404s the app itself', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ id: 'not_found', message: "Couldn't find that app." }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );

    try {
      await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
    }
  });

  it('reports not-yet-available when Heroku has no builds yet', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const result = await Output.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', buildStatus: 'SUCCEEDED' });
    expect(sfCommandStubs.info.firstCall.args[0]).to.include("hasn't produced output yet");
  });
});
