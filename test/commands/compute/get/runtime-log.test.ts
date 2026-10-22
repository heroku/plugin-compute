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

import RuntimeLog from '../../../../src/commands/compute/get/runtime-log.js';

// Every proxy-bound request lands on the same /services/data/vXX.0/connect/compute/proxy path with the
// real Heroku target URL percent-encoded into the proxy_url query param -- decode it to inspect
// which Heroku path/app a given call actually targeted, mirroring how herokuProxyRequest builds
// it in herokuProxyApi.ts (see scale.test.ts/get/build-log.test.ts for the same helper).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Org.create()/getConnection() issues its own Organization-lookup request through the same
// shared requestStub while resolving --target-org, so callCount/called on the stub itself is
// unreliable -- filter for the specific log-sessions call instead (mirrors get/build-log.test.ts).
function findLogSessionCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {url?: string};
    return req?.url !== undefined && proxyTarget(req.url).endsWith('/log-sessions');
  });
}

describe('compute get runtime-log', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;
  let fetchStub: MockInstance;

  const deployedRecord = {
    CurrentBuild: {
      BuildCompletedAt: '2026-08-31T14:25:32.000Z',
      BuildStartedAt: '2026-08-31T14:23:50.000Z',
      BuildStatus: 'SUCCEEDED',
      DeployedAt: '2026-08-31T14:25:32.000Z',
      DeployedBy: {Username: 'dev@mycompany.com'},
      Error: null,
      Id: '0acEE0000004D1ZYAU',
    },
    Description: null,
    DeveloperName: 'CreditRatingScorer',
    ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
    ExternalServiceRegistration: null,
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Credit Rating Scorer',
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

    requestStub = vi.fn().mockResolvedValue({logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1'});

    $$.fakeConnectionRequest = requestStub;

    fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('line one\nline two\n', {status: 200}));
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.mockResolvedValue({done: true, records, totalSize: records.length});
  }

  it('prints backfilled lines and returns them on the happy path', async () => {
    resolveWith([deployedRecord]);

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({lines: ['line one', 'line two'], name: 'CreditRatingScorer'});
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('line one');
    expect(output).toContain('line two');

    const call = findLogSessionCall(requestStub);
    expect(call, 'expected a POST to the Heroku proxy log-sessions path').toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/log-sessions',
    );
    const body = JSON.parse((call![0] as {body: string}).body) as {lines: number; tail: boolean};
    expect(body).toEqual({lines: 100, tail: false});
    expect(fetchStub).toHaveBeenCalledWith('https://logplex.heroku.com/sessions/abc?srv=1', {
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('fails fast on a Fir app, pointing at tail runtime-log, without creating a log session or fetching', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockResolvedValue({generation: {name: 'fir'}, name: 'credit-rating-scorer'});

    await expect(RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      'Fir apps keep no log history',
    );

    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('keeps the Cedar path unchanged when the app reports generation cedar', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockImplementation(async (req: {url?: string}) =>
      req.url !== undefined && proxyTarget(req.url).endsWith('/log-sessions')
        ? {logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1'}
        : {generation: {name: 'cedar'}, name: 'credit-rating-scorer'},
    );

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({lines: ['line one', 'line two'], name: 'CreditRatingScorer'});
  });

  it('falls through to the Cedar path when the generation lookup fails', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockImplementation(async (req: {url?: string}) => {
      if (req.url !== undefined && proxyTarget(req.url).endsWith('/log-sessions')) {
        return {logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1'};
      }

      throw new Error('proxy unavailable');
    });

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({lines: ['line one', 'line two'], name: 'CreditRatingScorer'});
  });

  it('prints the partial output and warns when the log fetch times out after some lines arrived', async () => {
    resolveWith([deployedRecord]);
    const encoder = new TextEncoder();
    fetchStub.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('line one\n'));
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return new Response(body, {status: 200});
    });
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    setTimeout(() => {
      deadline.abort(new DOMException('timed out', 'TimeoutError'));
    }, 20);

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.lines).toStrictEqual(['line one']);
    expect(sfCommandStubs.warn.firstCall.args[0]).toContain("didn't finish arriving in time");
  });

  it('reports no builds yet and returns just the name when CurrentBuild is null, without calling the proxy or fetch', async () => {
    resolveWith([{...deployedRecord, CurrentBuild: null}]);

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.firstCall.args[0]).toContain('has no builds yet');
    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports no log lines yet when the logplex fetch returns empty output', async () => {
    resolveWith([deployedRecord]);
    fetchStub.mockResolvedValue(new Response('', {status: 200}));

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.lastCall.args[0]).toContain('no log output yet');
  });

  it('passes --num through as the backfill line count', async () => {
    resolveWith([deployedRecord]);

    await RuntimeLog.run(['--name', 'CreditRatingScorer', '--num', '500', '--target-org', testOrg.username]);

    const call = findLogSessionCall(requestStub);
    const body = JSON.parse((call![0] as {body: string}).body) as {lines: number; tail: boolean};
    expect(body).toEqual({lines: 500, tail: false});
  });

  it('propagates the not-found error from the SOQL pre-check without calling the proxy or fetch', async () => {
    resolveWith([]);

    await expect(RuntimeLog.run(['--name', 'NeverDeployed', '--target-org', testOrg.username])).rejects.toThrow('No compute app named NeverDeployed was found in the org');

    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app has a build but no ExternalAppIdentifier yet, without calling the proxy or fetch', async () => {
    resolveWith([{...deployedRecord, ExternalAppIdentifier: undefined}]);

    await expect(RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the log-session creation', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    await expect(RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("Heroku didn't find an app named CreditRatingScorer");
  });

  it('wraps a genuine session-creation transport failure as error.herokuApiRequestFailed', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
  });

  it('preserves the exact case of --name in the SOQL filter and targets the resolved Heroku app id', async () => {
    resolveWith([deployedRecord]);

    await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql = toolingQueryStub.mock.calls[0][0] as string;
    expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    const call = findLogSessionCall(requestStub);
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/log-sessions',
    );
  });

  it('rejects an invalid --name before querying or calling the proxy', async () => {
    await expect(RuntimeLog.run(['--name', '../evil', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findLogSessionCall(requestStub)).toBeUndefined();
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([deployedRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await RuntimeLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const soql = toolingQueryStub.mock.calls[0][0] as string;
      expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([deployedRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-get-runtime-log-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await RuntimeLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-get-runtime-log-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await RuntimeLog.run(['--target-org', testOrg.username]);
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

  it('drops the lines key under --json for the no-builds-yet case', async () => {
    resolveWith([{...deployedRecord, CurrentBuild: null}]);

    const result = await RuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);
    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as Record<string, unknown>;

    expect(JSON.stringify(jsonOutput)).not.toContain('"lines"');
    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
  });
});
