import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
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

import BuildLog from '../../../../src/commands/compute/get/build-log.js';

// jsforce's HttpApi.getError() sets both .name and .errorCode to the parsed error body's
// errorCode, falling back to `ERROR_HTTP_${status}` when the body isn't a recognizable
// { message, errorCode } shape -- this is the exact shape a 404 with no body takes. Modeled as
// a subclass so .name is set in the constructor rather than assigned onto a built-in Error.
class HttpError extends Error {
  public readonly errorCode: string;

  public constructor(status: number, message = 'Not Found') {
    super(message);
    this.name = `ERROR_HTTP_${status}`;
    this.errorCode = `ERROR_HTTP_${status}`;
  }
}

function httpError(status: number, message = 'Not Found'): Error {
  return new HttpError(status, message);
}

// Every proxy-bound request lands on the same /services/data/vXX.0/connect/compute/proxy path with the
// real Heroku target URL percent-encoded into the proxy_url query param -- decode it to inspect
// which Heroku path/app a given call actually targeted, mirroring how herokuProxyRequest builds
// it in herokuProxyApi.ts (see scale.test.ts/config/unset.test.ts for the same helper).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Org.create()/getConnection() issues its own Organization-lookup request through the same
// shared requestStub while resolving --target-org, so callCount/called on the stub itself is
// unreliable -- filter for the specific listBuilds call instead (mirrors logs.test.ts).
function findListBuildsCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {url?: string};
    return req?.url !== undefined && proxyTarget(req.url).endsWith('/builds');
  });
}

describe('compute get build-log', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;
  let fetchStub: MockInstance;

  const buildingRecord = {
    CurrentBuild: {
      BuildCompletedAt: null,
      BuildStartedAt: '2026-08-31T14:23:50.000Z',
      BuildStatus: 'BUILDING',
      DeployedAt: null,
      DeployedBy: null,
      Error: null,
      Id: '0acEE0000004D1ZYAU',
    },
    Description: null,
    DeveloperName: 'CreditRatingScorer',
    ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
    ExternalServiceRegistration: null,
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Credit Rating Scorer',
    Status: 'DEPLOYING',
    StatusReason: null,
  };

  const succeededRecord = {
    ...buildingRecord,
    CurrentBuild: {
      ...buildingRecord.CurrentBuild,
      BuildCompletedAt: '2026-08-31T14:25:32.000Z',
      BuildStatus: 'SUCCEEDED',
      DeployedAt: '2026-08-31T14:25:32.000Z',
      DeployedBy: {Username: 'dev@mycompany.com'},
    },
    Status: 'ACTIVE',
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue([{output_stream_url: 'https://build-output.heroku.com/streams/abc'}]);

    $$.fakeConnectionRequest = requestStub;

    fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('-----> Building on the Heroku-24 stack\nBuild succeeded!\n', {status: 200}),
    );
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.mockResolvedValue({done: true, records, totalSize: records.length});
  }

  it('prints the log and returns name, buildStatus, and log on the happy path', async () => {
    resolveWith([succeededRecord]);

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({
      buildStatus: 'SUCCEEDED',
      log: '-----> Building on the Heroku-24 stack\nBuild succeeded!\n',
      name: 'CreditRatingScorer',
    });
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('Build succeeded!');

    const call = findListBuildsCall(requestStub);
    expect(call, 'expected a GET to the Heroku proxy listBuilds path').toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/builds',
    );
    expect(fetchStub.mock.calls.map(c => c[0] as unknown)).toContain('https://build-output.heroku.com/streams/abc');
  });

  it('throws error.herokuAppIdentifierUnavailable when the app has a build but no ExternalAppIdentifier yet, without calling the proxy or fetch', async () => {
    resolveWith([{...buildingRecord, ExternalAppIdentifier: undefined}]);

    await expect(BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findListBuildsCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports no builds yet and returns just the name when CurrentBuild is null', async () => {
    resolveWith([{...buildingRecord, CurrentBuild: null}]);

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.firstCall.args[0]).toContain('has no builds yet');
    expect(findListBuildsCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports not-yet-available and returns buildStatus without log when the latest build has no output_stream_url', async () => {
    resolveWith([buildingRecord]);
    requestStub.mockResolvedValue([{}]);

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({buildStatus: 'BUILDING', name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.firstCall.args[0]).toContain("hasn't produced output yet");
    expect(sfCommandStubs.log.called).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports not-yet-available when Heroku has no builds for the app yet (empty listBuilds)', async () => {
    resolveWith([buildingRecord]);
    requestStub.mockResolvedValue([]);

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({buildStatus: 'BUILDING', name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.firstCall.args[0]).toContain("hasn't produced output yet");
  });

  it('takes the last build when listBuilds returns several, oldest-first', async () => {
    resolveWith([succeededRecord]);

    requestStub.mockResolvedValue([
      {output_stream_url: 'https://build-output.heroku.com/streams/old'},
      {output_stream_url: 'https://build-output.heroku.com/streams/latest'},
    ]);

    await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(fetchStub.mock.calls.map(c => c[0] as unknown)).toContain('https://build-output.heroku.com/streams/latest');
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s listBuilds', async () => {
    resolveWith([buildingRecord]);
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    await expect(BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("Heroku didn't find an app named CreditRatingScorer");
  });

  it('propagates the not-found error from the SOQL pre-check without calling the Heroku proxy', async () => {
    resolveWith([]);

    await expect(BuildLog.run(['--name', 'NeverDeployed', '--target-org', testOrg.username])).rejects.toThrow('No compute app named NeverDeployed was found in the org');

    expect(findListBuildsCall(requestStub)).toBeUndefined();
  });

  it('propagates the ambiguous-name error from the SOQL pre-check without calling the Heroku proxy', async () => {
    resolveWith([buildingRecord, buildingRecord]);

    await expect(BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('Found more than one compute app named CreditRatingScorer');

    expect(findListBuildsCall(requestStub)).toBeUndefined();
  });

  it('wraps a genuine proxy transport failure as error.herokuApiRequestFailed', async () => {
    resolveWith([buildingRecord]);
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
  });

  it('wraps a failed content fetch of output_stream_url distinctly', async () => {
    resolveWith([succeededRecord]);
    fetchStub.mockRejectedValue(httpError(404));

    await expect(BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("Couldn't fetch build output");
  });

  it('still logs and returns an empty-string build log rather than treating it as not-yet-available', async () => {
    resolveWith([succeededRecord]);
    fetchStub.mockResolvedValue(new Response('', {status: 200}));

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({buildStatus: 'SUCCEEDED', log: '', name: 'CreditRatingScorer'});
  });

  it('drops undefined keys under --json for the no-builds-yet case', async () => {
    resolveWith([{...buildingRecord, CurrentBuild: null}]);

    const result = await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).not.toContain('buildStatus');
    expect(JSON.stringify(jsonOutput)).not.toContain('"log"');
    expect(result).toEqual({name: 'CreditRatingScorer'});
  });

  it('preserves the exact case of --name in the SOQL filter and targets the resolved Heroku app id', async () => {
    resolveWith([succeededRecord]);

    await BuildLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql = toolingQueryStub.mock.calls[0][0] as string;
    expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    const call = findListBuildsCall(requestStub);
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/builds',
    );
  });

  it('rejects an invalid --name before querying or calling the Heroku proxy', async () => {
    await expect(BuildLog.run(['--name', '../evil', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findListBuildsCall(requestStub)).toBeUndefined();
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([succeededRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await BuildLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const soql = toolingQueryStub.mock.calls[0][0] as string;
      expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
      const call = findListBuildsCall(requestStub);
      expect(proxyTarget((call![0] as {url: string}).url)).toBe(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/builds',
      );
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([succeededRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-build-log-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await BuildLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-build-log-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await BuildLog.run(['--target-org', testOrg.username]);
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
