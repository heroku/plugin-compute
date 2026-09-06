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
import Logs from '../../../src/commands/compute/logs.js';

// Org.create()/getConnection() issues its own Organization-lookup request through the same
// shared requestStub while resolving --target-org, so callCount/called on the stub itself is
// unreliable -- filter for the specific logs-session call instead (mirrors build/output.test.ts).
function findLogSessionCall(stub: sinon.SinonStub): sinon.SinonSpyCall | undefined {
  return stub
    .getCalls()
    .find((call) => (call.args[0] as { url?: string } | undefined)?.url?.includes('/connect/compute/logs/session'));
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('compute logs', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  const deployedRecord = {
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

    requestStub = sinon.stub().resolves({ logplexUrl: 'https://logplex.heroku.com/sessions/abc?srv=1' });
    $$.fakeConnectionRequest = requestStub;

    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch').resolves(new Response('line one\nline two\n', { status: 200 }));
  });

  afterEach(() => {
    $$.restore();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.resolves({ totalSize: records.length, records, done: true });
  }

  it('prints backfilled lines and returns them on the non-tail happy path', async () => {
    resolveWith([deployedRecord]);

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', lines: ['line one', 'line two'] });
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('line one');
    expect(output).to.include('line two');

    const call = findLogSessionCall(requestStub);
    expect(call, 'expected a POST to /connect/compute/logs/session').to.not.be.undefined;
    const body = JSON.parse((call!.args[0] as { body: string }).body);
    expect(body).to.deep.equal({ name: 'CreditRatingScorer', lines: 100, tail: false });
  });

  it('reports no builds yet and returns just the name when CurrentBuild is null, without calling Connect or fetch', async () => {
    resolveWith([{ ...deployedRecord, CurrentBuild: null }]);

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
    expect(sfCommandStubs.info.firstCall.args[0]).to.include('has no builds yet');
    expect(findLogSessionCall(requestStub)).to.be.undefined;
    expect(fetchStub.called).to.be.false;
  });

  it('reports no log lines yet when the logplex fetch returns empty output', async () => {
    resolveWith([deployedRecord]);
    fetchStub.resolves(new Response('', { status: 200 }));

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
    expect(sfCommandStubs.info.lastCall.args[0]).to.include('no log output yet');
  });

  it('passes --num through as the backfill line count', async () => {
    resolveWith([deployedRecord]);

    await Logs.run(['--name', 'CreditRatingScorer', '--num', '500', '--target-org', testOrg.username]);

    const call = findLogSessionCall(requestStub);
    const body = JSON.parse((call!.args[0] as { body: string }).body);
    expect(body).to.deep.equal({ name: 'CreditRatingScorer', lines: 500, tail: false });
  });

  it('streams lines and reports the session ending naturally under --tail', async () => {
    resolveWith([deployedRecord]);
    fetchStub.resolves(new Response(streamOf(['line one\n', 'line two\n']), { status: 200 }));

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--tail', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('line one');
    expect(output).to.include('line two');
    expect(sfCommandStubs.info.lastCall.args[0]).to.include('ended');

    const call = findLogSessionCall(requestStub);
    const body = JSON.parse((call!.args[0] as { body: string }).body);
    expect(body).to.deep.equal({ name: 'CreditRatingScorer', lines: 100, tail: true });
  });

  it('rejects combining --tail with --json before any org call is made', async () => {
    resolveWith([deployedRecord]);

    try {
      await Logs.run(['--name', 'CreditRatingScorer', '--tail', '--json', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('cannot also be provided when using --tail');
    }
    expect(toolingQueryStub.called).to.be.false;
  });

  it('propagates the not-found error from the SOQL pre-check without calling Connect or fetch', async () => {
    resolveWith([]);

    try {
      await Logs.run(['--name', 'NeverDeployed', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No compute app named NeverDeployed was found in the org');
    }
    expect(findLogSessionCall(requestStub)).to.be.undefined;
    expect(fetchStub.called).to.be.false;
  });

  it('wraps a genuine session-creation failure distinctly', async () => {
    resolveWith([deployedRecord]);
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't create a log session: socket hang up");
    }
  });

  it('preserves the exact case of --name in both the SOQL filter and the Connect API body', async () => {
    resolveWith([deployedRecord]);

    await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    const call = findLogSessionCall(requestStub);
    const body: { name: string } = JSON.parse((call!.args[0] as { body: string }).body);
    expect(body.name).to.equal('CreditRatingScorer');
  });

  it('rejects an invalid --name before querying or calling Connect', async () => {
    try {
      await Logs.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
    expect(findLogSessionCall(requestStub)).to.be.undefined;
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([deployedRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Logs.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const soql: string = toolingQueryStub.firstCall.args[0];
      expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([deployedRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-logs-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await Logs.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-logs-empty-'));
    process.chdir(tmp);
    try {
      await Logs.run(['--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't determine which compute app to use");
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
    expect(toolingQueryStub.called).to.be.false;
  });

  it('drops the lines key under --json for the no-builds-yet case', async () => {
    resolveWith([{ ...deployedRecord, CurrentBuild: null }]);

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).to.not.include('"lines"');
    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
  });
});

describe('compute logs with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let requestStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  const deployedRecord = {
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
    toolingQueryStub.resolves({ totalSize: 1, records: [deployedRecord], done: true });

    // Distinct from the Heroku log-sessions call below so a stray Connect call is easy to notice.
    requestStub = sinon.stub().resolves({ logplexUrl: 'https://connect-api-path-not-used.example/sessions/abc' });
    $$.fakeConnectionRequest = requestStub;

    process.env.HEROKU_API_TOKEN = 'shh-secret-token';
    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
    $$.restore();
  });

  function stubLogSessionAndLogplex(logplexUrl: string, logplexResponse: Response): void {
    fetchStub.callsFake(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/log-sessions')) {
        // eslint-disable-next-line camelcase -- logplex_url is Heroku's LogSession field name
        return new Response(JSON.stringify({ id: 'sess1', logplex_url: logplexUrl }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === logplexUrl) {
        return logplexResponse;
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
  }

  it('creates the log session via Heroku directly and prints backfilled lines, without calling Connect', async () => {
    stubLogSessionAndLogplex(
      'https://logplex.heroku.com/sessions/direct?srv=1',
      new Response('line one\nline two\n', { status: 200 })
    );

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer', lines: ['line one', 'line two'] });
    expect(findLogSessionCall(requestStub)).to.be.undefined;
  });

  it('creates the log session via Heroku directly under --tail', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('line one\n'));
        controller.close();
      },
    });
    stubLogSessionAndLogplex('https://logplex.heroku.com/sessions/direct?srv=1', new Response(stream, { status: 200 }));

    const result = await Logs.run(['--name', 'CreditRatingScorer', '--tail', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({ name: 'CreditRatingScorer' });
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('line one');
    expect(findLogSessionCall(requestStub)).to.be.undefined;
  });

  it('surfaces a hard herokuAppNotFound error when Heroku 404s the app itself', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ id: 'not_found', message: "Couldn't find that app." }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );

    try {
      await Logs.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
    }
    expect(findLogSessionCall(requestStub)).to.be.undefined;
  });
});
