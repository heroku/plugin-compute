import type {Mock, MockInstance} from 'vitest';

import {Org, type SfError} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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

import Display from '../../../src/commands/compute/display.js';

describe('compute display', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;

  const activeRecord = {
    CurrentBuild: {
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildStatus: 'SUCCEEDED',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: {Username: 'dev@mycompany.com'},
      Error: null,
      Id: '0acEE0000004D1ZYAU',
    },
    Description: 'Parses lease agreements.',
    DeveloperName: 'CreditRatingScorer',
    ExternalServiceRegistration: {Id: '0ES0x00000ABC456', IsActive: true},
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Lease Agreement Parser',
    Status: 'ACTIVE',
    StatusReason: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.mockResolvedValue({done: true, records, totalSize: records.length});
  }

  it('returns the flattened result for an active app with a current build', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({
      currentBuild: {
        buildCompletedAt: '2026-08-04T14:25:32.000Z',
        buildStartedAt: '2026-08-04T14:23:50.000Z',
        buildStatus: 'SUCCEEDED',
        deployedAt: '2026-08-04T14:25:32.000Z',
        deployedBy: 'dev@mycompany.com',
        error: undefined,
        id: '0acEE0000004D1ZYAU',
      },
      description: 'Parses lease agreements.',
      externalServiceActive: true,
      externalServiceId: '0ES0x00000ABC456',
      externalServiceRegistered: true,
      formation: undefined,
      id: '0abEE0000004CqYYAU',
      masterLabel: 'Lease Agreement Parser',
      name: 'CreditRatingScorer',
      orgId: testOrg.orgId,
      release: undefined,
      status: 'ACTIVE',
      statusReason: undefined,
    });

    const soql = toolingQueryStub.mock.calls[0][0] as string;
    expect(soql).toContain("WHERE DeveloperName = 'CreditRatingScorer'");
  });

  it('includes currentBuild in the JSON result even without --verbose', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).toBeDefined();
    const output =
      sfCommandStubs.styledHeader
        ?.getCalls()
        .flatMap(c => c.args)
        .join('\n') ?? '';
    expect(output).not.toContain('Current Build');
    expect(output).not.toContain('Latest Deployment');
    expect(output).not.toContain('External Service');
  });

  it('always renders the Heroku App section, verbose or not', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const headers = sfCommandStubs.styledHeader.getCalls().flatMap(c => c.args);
    expect(headers).toContain('Heroku App');
  });

  it('renders External Service, Current Build, and Latest Deployment sections under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const headers = sfCommandStubs.styledHeader.getCalls().flatMap(c => c.args);
    expect(headers).toContain('External Service');
    expect(headers).toContain('Current Build');
    expect(headers).toContain('Latest Deployment');
  });

  // Header presence alone doesn't confirm the row *contents* -- Build ID and Build Duration are
  // computed/mapped fields (formatBuildDuration in particular), not passed through verbatim, so
  // assert the actual table() call args the way list.test.ts does for its columns.
  it('renders the Compute App ID/Org ID rows and the computed Build ID/Build Duration rows under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{data: Array<{key: string; value: string}>}];
    }>;
    const allRows = tableCalls.flatMap(c => c.args[0].data);

    expect(allRows).toContainEqual({key: 'Compute App ID', value: '0abEE0000004CqYYAU'});
    expect(allRows).toContainEqual({key: 'Org ID', value: testOrg.orgId});
    expect(allRows).toContainEqual({key: 'Build ID', value: '0acEE0000004D1ZYAU'});
    // BuildStartedAt 14:23:50 -> BuildCompletedAt 14:25:32 is 1m 42s.
    expect(allRows).toContainEqual({key: 'Build Duration', value: '1m 42s'});
  });

  // Slug and Deploy ID had no wired-up source (Salesforce or Heroku) and no GA scope to justify
  // them -- cut rather than left as permanent placeholder dashes. AppLink Add-on was cut too --
  // it's redundant with External Service ID (both set together by deploy's first-time
  // provisioning). Release *is* a real row now (sourced from the Heroku proxy's releases
  // endpoint, see the 'compute display via the Heroku proxy' describe block) -- it's excluded
  // from this org-only-stub test's assertions on purpose, not because it's unsourced.
  it('omits the unsourced Slug and Deploy ID rows, and the redundant AppLink Add-on row, under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{data: Array<{key: string; value: string}>}];
    }>;
    const allKeys = tableCalls.flatMap(c => c.args[0].data.map(row => row.key));

    expect(allKeys).not.toContain('AppLink Add-on');
    expect(allKeys).not.toContain('Slug');
    expect(allKeys).not.toContain('Deploy ID');
  });

  it('handles an app that has never had a successful build or external service registration', async () => {
    resolveWith([
      {
        ...activeRecord,
        CurrentBuild: null,
        ExternalServiceRegistration: null,
        Status: 'DEPLOYING',
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).toBeUndefined();
    expect(result.externalServiceId).toBeUndefined();
    expect(result.externalServiceRegistered).toBe(false);
    expect(result.externalServiceActive).toBeUndefined();
  });

  it('skips all Heroku proxy calls and leaves herokuApp/formation/release undefined when ExternalAppIdentifier is missing, without warning', async () => {
    resolveWith([{...activeRecord, ExternalAppIdentifier: undefined}]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.herokuApp).toBeUndefined();
    expect(result.formation).toBeUndefined();
    expect(result.release).toBeUndefined();
    expect(sfCommandStubs.warn.called).toBe(false);
  });

  it('omits description and reports a status reason when the app has neither a description nor a build', async () => {
    resolveWith([
      {
        ...activeRecord,
        CurrentBuild: null,
        Description: null,
        Status: 'FAILED',
        StatusReason: 'Buildpack detection failed.',
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.description).toBeUndefined();
    expect(result.statusReason).toBe('Buildpack detection failed.');
  });

  it('preserves the exact case of --name in the SOQL filter', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql = toolingQueryStub.mock.calls[0][0] as string;
    expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    expect(soql).not.toContain("DeveloperName = 'creditratingscorer'");
  });

  it('fails with a deploy hint when the app is not found in the org', async () => {
    resolveWith([]);

    let error: Error | undefined;
    try {
      await Display.run(['--name', 'NeverDeployed', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('No compute app named NeverDeployed was found in the org');
    const actions = (error as SfError).actions ?? [];
    expect(actions.join('\n')).toContain('project deploy start');
    expect(actions.join('\n')).not.toContain('%s');
  });

  it('fails when more than one matching app is found', async () => {
    resolveWith([activeRecord, activeRecord]);

    await expect(Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('Found more than one compute app named CreditRatingScorer');
  });

  it('wraps an unexpected query failure', async () => {
    toolingQueryStub.mockRejectedValue(new Error('INVALID_SESSION_ID'));

    await expect(Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("Couldn't query compute app details: INVALID_SESSION_ID");
  });

  it('rejects an invalid name before querying', async () => {
    await expect(Display.run(['--name', '../evil', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('echoes the namespace-qualified --name value verbatim, not the namespace-stripped DeveloperName', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'myns__CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.name).toBe('myns__CreditRatingScorer');
    const soql = toolingQueryStub.mock.calls[0][0] as string;
    expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    expect(soql).toContain("Namespace = 'myns'");
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([activeRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Display.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const soql = toolingQueryStub.mock.calls[0][0] as string;
      expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it('prefers an explicit --name over a different COMPUTE_APP_NAME value', async () => {
    resolveWith([activeRecord]);
    process.env.COMPUTE_APP_NAME = 'SomeOtherApp';
    try {
      const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const soql = toolingQueryStub.mock.calls[0][0] as string;
      expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
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
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-display-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await Display.run(['--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain("Couldn't determine which compute app to use");

    expect(toolingQueryStub).not.toHaveBeenCalled();
  });
});

describe('compute display via the Heroku proxy', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;

  const activeRecord = {
    CurrentBuild: {
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildStatus: 'SUCCEEDED',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: {Username: 'dev@mycompany.com'},
      Error: null,
      Id: '0acEE0000004D1ZYAU',
    },
    Description: 'Parses lease agreements.',
    DeveloperName: 'CreditRatingScorer',
    ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
    ExternalServiceRegistration: {Id: '0ES0x00000ABC456', IsActive: true},
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Lease Agreement Parser',
    Status: 'ACTIVE',
    StatusReason: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
    toolingQueryStub.mockResolvedValue({done: true, records: [activeRecord], totalSize: 1});

    // connection.request is already wrapped by TestContext's own beforeEach (see stubContext in
    // @salesforce/core/testSetup) and dispatches through $$.fakeConnectionRequest -- stubbing it
    // again here would throw "Attempted to wrap request which is already wrapped".
    requestStub = vi.fn();
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  // App, formation and release are all fetched via the same connection.request stub -- distinguish
  // calls by their proxy_url target path rather than call order, since the fetches in display.ts
  // run in an order that's an implementation detail, not a contract. The /apps/<id> branch must
  // stay last: its substring is a prefix of the /formation and /releases URLs, so those are checked
  // first.
  function stubProxyResponses(formation: unknown, release: unknown, app: unknown = {}): void {
    requestStub.mockImplementation(async (req: {url: string}) => {
      if (req.url.includes(encodeURIComponent('/formation'))) {
        return formation;
      }

      if (req.url.includes(encodeURIComponent('/releases'))) {
        return release;
      }

      if (req.url.includes(encodeURIComponent('/apps/a1b2c3d4-heroku-app-id'))) {
        return app;
      }

      throw new Error(`unexpected proxy request: ${req.url}`);
    });
  }

  it('supplements the org-side result with the dyno formation and release, and renders both in the Heroku App table', async () => {
    stubProxyResponses(
      [{dyno_size: {id: 'sz1', name: 'Standard-1X'}, quantity: 2, type: 'web'}],
      [{version: 11}],
    );

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).toEqual([{dynoSize: 'Standard-1X', quantity: 2, type: 'web'}]);
    expect(result.release).toBe(11);
    const headers = sfCommandStubs.styledHeader.getCalls().flatMap(c => c.args);
    expect(headers).toContain('Heroku App');

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{data: Array<{key: string; value: string}>}];
    }>;
    const allRows = tableCalls.flatMap(c => c.args[0].data);
    expect(allRows).toContainEqual({key: 'Formation', value: 'web=2:Standard-1X'});
    expect(allRows).toContainEqual({key: 'Release', value: '11'});
  });

  it('renders the App Name, Region, and Generation rows from the Heroku app fetch', async () => {
    stubProxyResponses([], [], {generation: {name: 'fir'}, name: 'lease-agreement-parser', region: {name: 'us'}});

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{data: Array<{key: string; value: string}>}];
    }>;
    const allRows = tableCalls.flatMap(c => c.args[0].data);
    expect(allRows).toContainEqual({key: 'App Name', value: 'lease-agreement-parser'});
    expect(allRows).toContainEqual({key: 'Region', value: 'us'});
    expect(allRows).toContainEqual({key: 'Generation', value: 'fir'});
    expect(sfCommandStubs.warn.called).toBe(false);
  });

  it('omits herokuApp from the result and --json output when the app has no name, region, or generation', async () => {
    stubProxyResponses([{dyno_size: {name: 'Basic'}, quantity: 1, type: 'web'}], [{version: 7}], {});

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    expect(result.herokuApp).toBeUndefined();
    expect(result.formation).toEqual([{dynoSize: 'Basic', quantity: 1, type: 'web'}]);
    expect(result.release).toBe(7);
    expect(sfCommandStubs.warn.called).toBe(false);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;
    expect(JSON.stringify(jsonOutput)).not.toContain('herokuApp');
    expect(JSON.stringify(jsonOutput)).toContain('formation');
    expect(JSON.stringify(jsonOutput)).toContain('"release":7');
  });

  it('warns and still renders formation and release when the app proxy call fails, without herokuApp in the result', async () => {
    requestStub.mockImplementation(async (req: {url: string}) => {
      if (req.url.includes(encodeURIComponent('/formation'))) {
        return [{dyno_size: {name: 'Basic'}, quantity: 1, type: 'web'}];
      }

      if (req.url.includes(encodeURIComponent('/releases'))) {
        return [{version: 4}];
      }

      throw new Error('socket hang up');
    });

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.herokuApp).toBeUndefined();
    const tableCalls = sfCommandStubs.table.getCalls() as unknown as Array<{
      args: [{data: Array<{key: string; value: string}>}];
    }>;
    const allRows = tableCalls.flatMap(c => c.args[0].data);
    expect(allRows).toContainEqual({key: 'Formation', value: 'web=1:Basic'});
    expect(allRows).toContainEqual({key: 'Release', value: '4'});
    expect(
      sfCommandStubs.warn
        .getCalls()
        .map(c => c.args[0] as string)
        .join('\n'),
    ).toContain("Couldn't fetch app details from Heroku");
  });

  it('still renders the Heroku App table (with a placeholder Formation row) when the formation is empty', async () => {
    stubProxyResponses([], []);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).toEqual([]);
    expect(result.release).toBeUndefined();
    const headers = sfCommandStubs.styledHeader.getCalls().flatMap(c => c.args);
    expect(headers).toContain('Heroku App');
  });

  it('warns and still returns the org-side result when the formation proxy call fails, without formation in the result', async () => {
    requestStub.mockImplementation(async (req: {url: string}) => {
      if (req.url.includes(encodeURIComponent('/formation'))) {
        throw new Error('socket hang up');
      }

      return [];
    });

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).toBeUndefined();
    expect(result.release).toBeUndefined();
    expect(result.status).toBe('ACTIVE');
    expect(
      sfCommandStubs.warn
        .getCalls()
        .map(c => c.args[0] as string)
        .join('\n'),
    ).toContain("Couldn't fetch dyno formation from Heroku");
  });

  it('warns and still returns the org-side result when the release proxy call fails, without release in the result', async () => {
    requestStub.mockImplementation(async (req: {url: string}) => {
      if (req.url.includes(encodeURIComponent('/releases'))) {
        throw new Error('socket hang up');
      }

      return [];
    });

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.formation).toEqual([]);
    expect(result.release).toBeUndefined();
    expect(result.status).toBe('ACTIVE');
    expect(
      sfCommandStubs.warn
        .getCalls()
        .map(c => c.args[0] as string)
        .join('\n'),
    ).toContain("Couldn't fetch the latest release from Heroku");
  });

  it('drops the herokuApp, formation and release keys from --json output when all three proxy calls fail', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).not.toContain('formation');
    expect(JSON.stringify(jsonOutput)).not.toContain('"release"');
    expect(JSON.stringify(jsonOutput)).not.toContain('herokuApp');
  });
});
