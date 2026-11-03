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

import TailRuntimeLog from '../../../../src/commands/compute/tail/runtime-log.js';

// Every proxy-bound request lands on the same /services/data/vXX.0/connect/compute/proxy path with the
// real Heroku target URL percent-encoded into the proxy_url query param -- decode it to inspect
// which Heroku path/app a given call actually targeted, mirroring how herokuProxyRequest builds
// it in herokuProxyApi.ts (see get/runtime-log.test.ts for the same helper).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Org.create()/getConnection() issues its own Organization-lookup request through the same
// shared requestStub while resolving --target-org, so callCount/called on the stub itself is
// unreliable -- filter for the specific log-sessions call instead (mirrors get/runtime-log.test.ts).
function findLogSessionCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {url?: string};
    return req?.url !== undefined && proxyTarget(req.url).endsWith('/log-sessions');
  });
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

describe('compute tail runtime-log', () => {
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

    fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(streamOf(['line one\n', 'line two\n']), {status: 200}));
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.mockResolvedValue({done: true, records, totalSize: records.length});
  }

  it('prints each newline-less chunk of a Fir session as its own line', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockImplementation(async (req: {url?: string}) =>
      req.url !== undefined && proxyTarget(req.url).endsWith('/log-sessions')
        ? {logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1'}
        : {generation: {name: 'fir'}, name: 'credit-rating-scorer'},
    );
    fetchStub.mockResolvedValue(new Response(streamOf(['fir one', 'fir two']), {status: 200}));

    await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(sfCommandStubs.log.getCalls().flatMap(c => c.args)).toEqual(['fir one', 'fir two']);
  });

  it('streams lines and reports the session ending naturally', async () => {
    resolveWith([deployedRecord]);

    const result = await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('line one');
    expect(output).toContain('line two');
    expect(sfCommandStubs.info.lastCall.args[0]).toContain('ended');

    const call = findLogSessionCall(requestStub);
    expect(call, 'expected a POST to the Heroku proxy log-sessions path').toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/log-sessions',
    );
    const body = JSON.parse((call![0] as {body: string}).body) as {lines: number; tail: boolean};
    expect(body).toEqual({lines: 100, tail: true});
    // streamLogplexOutput passes an AbortSignal as the second fetch arg, so assert only the URL.
    expect(fetchStub.mock.calls[0][0]).toBe('https://logplex.heroku.com/sessions/abc?srv=1');
  });

  it('warns instead of exiting silently when the session closes without sending any lines', async () => {
    resolveWith([deployedRecord]);
    fetchStub.mockResolvedValue(new Response(streamOf([]), {status: 200}));

    const result = await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
    expect(sfCommandStubs.warn.firstCall.args[0]).toContain('closed without sending any log lines');
  });

  it('does not warn when lines were received before the session ended', async () => {
    resolveWith([deployedRecord]);

    await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(sfCommandStubs.warn.called).toBe(false);
  });

  describe('SIGINT', () => {
    const frameworkListener = (): void => {
      throw new Error('framework SIGINT listener ran');
    };

    let listenersBefore: NodeJS.SignalsListener[];
    let originalListeners: NodeJS.SignalsListener[];

    beforeEach(() => {
      originalListeners = process.listeners('SIGINT');
      // Mirrors SfCommand._run(), which registers a throwing exit listener before run().
      process.on('SIGINT', frameworkListener);
      listenersBefore = process.listeners('SIGINT');
    });

    // SfCommand._run() itself adds one SIGINT listener on every run and never removes it, so the
    // restored set is the prior listeners plus that one -- and nothing of ours.
    function expectInheritedRestored(): void {
      const after = process.listeners('SIGINT');
      expect(after).toEqual(expect.arrayContaining(listenersBefore));
      expect(after).toHaveLength(listenersBefore.length + 1);
    }

    afterEach(() => {
      process.removeAllListeners('SIGINT');
      for (const listener of originalListeners) {
        process.on('SIGINT', listener);
      }

      process.exitCode = undefined;
    });

    it('stops quietly with exit code 130 on SIGINT, bypassing the inherited framework listener', async () => {
      resolveWith([deployedRecord]);
      fetchStub.mockImplementation(async (_url: unknown, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => {
              controller.error(new Error('aborted'));
            });
          },
        });
        return new Response(body, {status: 200});
      });

      const running = TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      // Generous timeout: the default 1s is too tight for the first run on a slow Windows runner.
      await vi.waitFor(
        () => {
          expect(fetchStub).toHaveBeenCalled();
        },
        {timeout: 10_000},
      );

      expect(() => process.emit('SIGINT')).not.toThrow();
      const result = await running;

      expect(result).toStrictEqual({name: 'CreditRatingScorer'});
      expect(sfCommandStubs.info.lastCall.args[0]).toContain('Stopped tailing');
      expect(process.exitCode).toBe(130);
      expectInheritedRestored();
    });

    it('restores the inherited SIGINT listeners and leaves exitCode alone when the stream ends naturally', async () => {
      resolveWith([deployedRecord]);

      await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

      expect(process.exitCode).toBeUndefined();
      expectInheritedRestored();
    });
  });

  it('passes --num through as the backfill line count before streaming', async () => {
    resolveWith([deployedRecord]);

    await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--num', '500', '--target-org', testOrg.username]);

    const call = findLogSessionCall(requestStub);
    const body = JSON.parse((call![0] as {body: string}).body) as {lines: number; tail: boolean};
    expect(body).toEqual({lines: 500, tail: true});
  });

  it('reports no builds yet and returns just the name when CurrentBuild is null, without calling the proxy or fetch', async () => {
    resolveWith([{...deployedRecord, CurrentBuild: null}]);

    const result = await TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toStrictEqual({name: 'CreditRatingScorer'});
    expect(sfCommandStubs.info.firstCall.args[0]).toContain('has no builds yet');
    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('rejects --json because this streaming command exposes no JSON output', async () => {
    resolveWith([deployedRecord]);

    await expect(
      TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--json', '--target-org', testOrg.username]),
    ).rejects.toThrow(/Nonexistent flag: --json/v);

    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('propagates the not-found error from the SOQL pre-check without calling the proxy or fetch', async () => {
    resolveWith([]);

    await expect(TailRuntimeLog.run(['--name', 'NeverDeployed', '--target-org', testOrg.username])).rejects.toThrow('No compute app named NeverDeployed was found in the org');

    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app has a build but no ExternalAppIdentifier yet, without calling the proxy or fetch', async () => {
    resolveWith([{...deployedRecord, ExternalAppIdentifier: undefined}]);

    await expect(TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findLogSessionCall(requestStub)).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the log-session creation', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    await expect(TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("Heroku didn't find an app named CreditRatingScorer");
  });

  it('wraps a genuine session-creation transport failure as error.herokuApiRequestFailed', async () => {
    resolveWith([deployedRecord]);
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(TailRuntimeLog.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
  });

  it('rejects an invalid --name before querying or calling the proxy', async () => {
    await expect(TailRuntimeLog.run(['--name', '../evil', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findLogSessionCall(requestStub)).toBeUndefined();
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    resolveWith([deployedRecord]);
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await TailRuntimeLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const soql = toolingQueryStub.mock.calls[0][0] as string;
      expect(soql).toContain("DeveloperName = 'CreditRatingScorer'");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.computeApp-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    resolveWith([deployedRecord]);
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-tail-runtime-log-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), '<ComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await TailRuntimeLog.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-tail-runtime-log-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await TailRuntimeLog.run(['--target-org', testOrg.username]);
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
