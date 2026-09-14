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
import { Org, SfError } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import Display from '../../../src/commands/compute/display.js';

describe('compute display', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;

  const activeRecord = {
    Id: '0abEE0000004CqYYAU',
    DeveloperName: 'CreditRatingScorer',
    MasterLabel: 'Lease Agreement Parser',
    Description: 'Parses lease agreements.',
    Status: 'ACTIVE',
    StatusReason: null,
    CurrentBuild: {
      Id: '0acEE0000004D1ZYAU',
      BuildStatus: 'SUCCEEDED',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: { Username: 'dev@mycompany.com' },
      Error: null,
    },
    ExternalServiceRegistration: { Id: '0ES0x00000ABC456', IsActive: true },
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
  });

  afterEach(() => {
    $$.restore();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.resolves({ totalSize: records.length, records, done: true });
  }

  it('returns the flattened result for an active app with a current build', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      id: '0abEE0000004CqYYAU',
      name: 'CreditRatingScorer',
      masterLabel: 'Lease Agreement Parser',
      description: 'Parses lease agreements.',
      status: 'ACTIVE',
      statusReason: undefined,
      externalServiceId: '0ES0x00000ABC456',
      externalServiceRegistered: true,
      externalServiceActive: true,
      currentBuild: {
        id: '0acEE0000004D1ZYAU',
        buildStatus: 'SUCCEEDED',
        buildStartedAt: '2026-08-04T14:23:50.000Z',
        buildCompletedAt: '2026-08-04T14:25:32.000Z',
        deployedAt: '2026-08-04T14:25:32.000Z',
        deployedBy: 'dev@mycompany.com',
        error: undefined,
      },
      orgId: testOrg.orgId,
      formation: undefined,
    });

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("WHERE DeveloperName = 'CreditRatingScorer'");
  });

  it('includes currentBuild in the JSON result even without --verbose', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).to.not.be.undefined;
    const output =
      sfCommandStubs.styledHeader
        ?.getCalls()
        .flatMap((c) => c.args)
        .join('\n') ?? '';
    expect(output).to.not.include('Current Build');
    expect(output).to.not.include('Latest Deployment');
    expect(output).to.not.include('External Service');
  });

  it('always renders the Heroku App section, verbose or not', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const headers = sfCommandStubs.styledHeader.getCalls().flatMap((c) => c.args);
    expect(headers).to.include('Heroku App');
  });

  it('renders External Service, Current Build, and Latest Deployment sections under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const headers = sfCommandStubs.styledHeader.getCalls().flatMap((c) => c.args);
    expect(headers).to.include('External Service');
    expect(headers).to.include('Current Build');
    expect(headers).to.include('Latest Deployment');
  });

  // Header presence alone doesn't confirm the row *contents* -- Build ID and Build Duration are
  // computed/mapped fields (formatBuildDuration in particular), not passed through verbatim, so
  // assert the actual table() call args the way list.test.ts does for its columns.
  it('renders the Compute App ID/Org ID rows and the computed Build ID/Build Duration rows under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{ data: Array<{ key: string; value: string }> }];
    }>;
    const allRows = tableCalls.flatMap((c) => c.args[0].data);

    expect(allRows).to.deep.include({ key: 'Compute App ID', value: '0abEE0000004CqYYAU' });
    expect(allRows).to.deep.include({ key: 'Org ID', value: testOrg.orgId });
    expect(allRows).to.deep.include({ key: 'Build ID', value: '0acEE0000004D1ZYAU' });
    // BuildStartedAt 14:23:50 -> BuildCompletedAt 14:25:32 is 1m 42s.
    expect(allRows).to.deep.include({ key: 'Build Duration', value: '1m 42s' });
  });

  it('handles an app that has never had a successful build or external service registration', async () => {
    resolveWith([
      {
        ...activeRecord,
        Status: 'DEPLOYING',
        CurrentBuild: null,
        ExternalServiceRegistration: null,
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).to.be.undefined;
    expect(result.externalServiceId).to.be.undefined;
    expect(result.externalServiceRegistered).to.be.false;
    expect(result.externalServiceActive).to.be.undefined;
  });

  it('omits description and reports a status reason when the app has neither a description nor a build', async () => {
    resolveWith([
      {
        ...activeRecord,
        Description: null,
        Status: 'FAILED',
        StatusReason: 'Buildpack detection failed.',
        CurrentBuild: null,
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.description).to.be.undefined;
    expect(result.statusReason).to.equal('Buildpack detection failed.');
  });

  it('preserves the exact case of --name in the SOQL filter', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    expect(soql).to.not.include("DeveloperName = 'creditratingscorer'");
  });

  it('fails with a deploy hint when the app is not found in the org', async () => {
    resolveWith([]);

    try {
      await Display.run(['--name', 'NeverDeployed', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No compute app named NeverDeployed was found in the org');
      const actions = (e as SfError).actions ?? [];
      expect(actions.join('\n')).to.include('compute deploy');
      expect(actions.join('\n')).to.not.include('%s');
    }
  });

  it('fails when more than one matching app is found', async () => {
    resolveWith([activeRecord, activeRecord]);

    try {
      await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Found more than one compute app named CreditRatingScorer');
    }
  });

  it('wraps an unexpected query failure', async () => {
    toolingQueryStub.rejects(new Error('INVALID_SESSION_ID'));

    try {
      await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });

  it('rejects an invalid name before querying', async () => {
    try {
      await Display.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([activeRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Display.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const soql: string = toolingQueryStub.firstCall.args[0];
      expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it('prefers an explicit --name over a different COMPUTE_APP_NAME value', async () => {
    resolveWith([activeRecord]);
    process.env.COMPUTE_APP_NAME = 'SomeOtherApp';
    try {
      const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const soql: string = toolingQueryStub.firstCall.args[0];
      expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([activeRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-display-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await Display.run(['--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-display-empty-'));
    process.chdir(tmp);
    try {
      await Display.run(['--target-org', testOrg.username]);
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

describe('compute display with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  const activeRecord = {
    Id: '0abEE0000004CqYYAU',
    DeveloperName: 'CreditRatingScorer',
    MasterLabel: 'Lease Agreement Parser',
    Description: 'Parses lease agreements.',
    Status: 'ACTIVE',
    StatusReason: null,
    CurrentBuild: {
      Id: '0acEE0000004D1ZYAU',
      BuildStatus: 'SUCCEEDED',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: { Username: 'dev@mycompany.com' },
      Error: null,
    },
    ExternalServiceRegistration: { Id: '0ES0x00000ABC456', IsActive: true },
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
    toolingQueryStub.resolves({ totalSize: 1, records: [activeRecord], done: true });

    process.env.HEROKU_API_TOKEN = 'shh-secret-token';
    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
    $$.restore();
  });

  it('supplements the org-side result with the dyno formation and renders it in the Heroku App table', async () => {
    fetchStub.resolves(
      // eslint-disable-next-line camelcase -- dyno_size is Heroku's Formation field name
      new Response(JSON.stringify([{ type: 'web', quantity: 2, dyno_size: { id: 'sz1', name: 'Standard-1X' } }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).to.deep.equal([{ type: 'web', dynoSize: 'Standard-1X', quantity: 2 }]);
    const headers = sfCommandStubs.styledHeader.getCalls().flatMap((c) => c.args);
    expect(headers).to.include('Heroku App');

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{ data: Array<{ key: string; value: string }> }];
    }>;
    const allRows = tableCalls.flatMap((c) => c.args[0].data);
    expect(allRows).to.deep.include({ key: 'Formation', value: 'web=2:Standard-1X' });
  });

  it('still renders the Heroku App table (with a placeholder Formation row) when the formation is empty', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).to.deep.equal([]);
    const headers = sfCommandStubs.styledHeader.getCalls().flatMap((c) => c.args);
    expect(headers).to.include('Heroku App');
  });

  it('warns and still returns the org-side result when the Heroku call fails, without formation in the result', async () => {
    fetchStub.resolves(new Response('server error', { status: 500 }));

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).to.be.undefined;
    expect(result.status).to.equal('ACTIVE');
    expect(sfCommandStubs.warn.lastCall.args[0]).to.include("Couldn't fetch dyno formation from Heroku");
    // this.warn()'s message is built from (err as Error).message -- confirm the token never
    // makes it into that string via this call site either, not just inside herokuComputeApi.ts.
    expect(sfCommandStubs.warn.lastCall.args[0]).to.not.include('shh-secret-token');
  });

  // The formation fetch can fail below the HTTP layer too (e.g. a network-level fetch rejection
  // rather than a non-2xx Response) -- confirm display.ts's catch-and-warn still downgrades that
  // gracefully instead of letting an unhandled rejection crash the command, and still returns the
  // org-only data.
  it('warns and still returns the org-side result when the Heroku call rejects at the network level', async () => {
    fetchStub.rejects(new TypeError('fetch failed'));

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).to.be.undefined;
    expect(result.status).to.equal('ACTIVE');
    expect(sfCommandStubs.warn.lastCall.args[0]).to.include("Couldn't fetch dyno formation from Heroku");
  });

  it('drops the formation key from --json output when the Heroku call fails', async () => {
    fetchStub.resolves(new Response('server error', { status: 500 }));

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).to.not.include('formation');
  });
});
