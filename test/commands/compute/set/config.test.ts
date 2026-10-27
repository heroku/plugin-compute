import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx, stubSpinner} from '@salesforce/sf-plugins-core';
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

import ConfigSet from '../../../../src/commands/compute/set/config.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts (see config.test.ts/scale.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// set.ts makes two separate proxy calls (PATCH .../config-vars, then GET .../releases), plus
// Org.create()/getConnection() issues its own request through this same shared requestStub while
// resolving --target-org -- so routing must key off both the decoded target and the method.
function findConfigVarsCall(stub: Mock, method?: string): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).endsWith('/config-vars') && (!method || req.method === method);
  });
}

function findReleasesCall(stub: Mock, method?: string): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).endsWith('/releases') && (!method || req.method === method);
  });
}

const computeAppRecord = {
  CurrentBuild: null,
  Description: null,
  DeveloperName: 'CreditRatingScorer',
  ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
  ExternalServiceRegistration: null,
  Id: '0abEE0000004CqYYAU',
  MasterLabel: 'Credit Rating Scorer',
  Status: 'ACTIVE',
  StatusReason: null,
};

describe('compute set config', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    toolingQueryStub.mockResolvedValue({done: true, records: [computeAppRecord], totalSize: 1});
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    // PATCH .../config-vars returns Heroku's raw (flat) updated ConfigVars map; the command
    // doesn't read it back into the result (it echoes `updates` instead), so its exact contents
    // only matter for tests that assert on it directly. GET .../releases is the second,
    // independent call set.ts makes to report a release number in its spinner/output.
    requestStub = vi.fn().mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {STRIPE_KEY: 'sk_live_xyz789'};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [{version: 11}];
      }

      return {};
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('keeps the pre-migration id as a hidden deprecated alias', () => {
    expect(ConfigSet.hiddenAliases).toEqual(['compute:config:set']);
    // Hidden, not visible: a visible alias would resurface the old id in --help/docs/snapshot.
    expect(ConfigSet.aliases).toEqual([]);
    expect(ConfigSet.deprecateAliases).toBe(true);
  });

  it('sets a single config var and echoes it back, with the release version', async () => {
    const result = await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({
      configVars: {STRIPE_KEY: 'sk_live_xyz789'},
      name: 'CreditRatingScorer',
      release: 11,
    });
    expect(sfCommandStubs.log.args.flat()).toEqual(['STRIPE_KEY=sk_live_xyz789']);
    expect(spinnerStubs.start.firstCall.args[0]).toBe('Setting config vars and restarting CreditRatingScorer');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done, v11');
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(patchCall, 'expected a PATCH proxied to Heroku config-vars').toBeDefined();
    expect(proxyTarget((patchCall![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
    );
    expect(JSON.parse((patchCall![0] as {body: string}).body)).toEqual({
      STRIPE_KEY: 'sk_live_xyz789',
    });
    const releasesCall = findReleasesCall(requestStub, 'GET');
    expect(releasesCall, 'expected a GET proxied to Heroku releases').toBeDefined();
  });

  it('echoes only the vars just set, in the order typed, not the full response map', async () => {
    const result = await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      'LOG_LEVEL=debug',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({
      configVars: {LOG_LEVEL: 'debug', STRIPE_KEY: 'sk_live_xyz789'},
      name: 'CreditRatingScorer',
      release: 11,
    });
    expect(sfCommandStubs.log.args.flat()).toEqual(['STRIPE_KEY=sk_live_xyz789', 'LOG_LEVEL=debug']);
  });

  it('splits only on the first =, so a value containing = is preserved whole', async () => {
    const result = await ConfigSet.run([
      'DB_URL=postgres://user:pass@host/db?ssl=true',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).toEqual({DB_URL: 'postgres://user:pass@host/db?ssl=true'});
  });

  it('accepts an empty value after the =, setting the key to an empty string', async () => {
    const result = await ConfigSet.run(['FOO=', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.configVars).toEqual({FOO: ''});
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall![0] as {body: string}).body)).toEqual({FOO: ''});
  });

  it('preserves whitespace around the key and value verbatim, without trimming', async () => {
    const result = await ConfigSet.run([
      ' FOO = bar ',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).toEqual({' FOO ': ' bar '});
  });

  it('last-write-wins when the same key is set twice in one invocation', async () => {
    const result = await ConfigSet.run([
      'FOO=1',
      'FOO=2',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.configVars).toEqual({FOO: '2'});
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall![0] as {body: string}).body)).toEqual({FOO: '2'});
  });

  it('omits release from the result when there are no releases yet', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {FOO: 'bar'};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [];
      }

      return {};
    });

    const result = await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({configVars: {FOO: 'bar'}, name: 'CreditRatingScorer'});
    expect(result).not.toHaveProperty('release');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done');
  });

  it('omits release, but still succeeds, when the release lookup itself fails (best-effort)', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {FOO: 'bar'};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        throw new Error('socket hang up');
      }

      return {};
    });

    const result = await ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({configVars: {FOO: 'bar'}, name: 'CreditRatingScorer'});
    expect(result).not.toHaveProperty('release');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done');
  });

  it('rejects a token with no =, without calling the Heroku proxy', async () => {
    let error: Error | undefined;
    try {
      await ConfigSet.run(['FOO_BAR', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toBe('"FOO_BAR" is not a valid KEY=VALUE pair. Use FOO_BAR=value.');

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('rejects when no pairs are given, without calling the Heroku proxy', async () => {
    await expect(ConfigSet.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('Specify at least one config var, for example `STRIPE_KEY=sk_live_...`.');

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed and prints no echo lines', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw new Error('socket hang up');
      }

      return {};
    });

    await expect(ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );

    expect(sfCommandStubs.log.called).toBe(false);
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('failed');
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'});
      }

      return {};
    });

    await expect(ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
    );

    expect(spinnerStubs.stop.firstCall.args[0]).toBe('failed');
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}});
      }

      return {};
    });

    await expect(ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('CreditRatingScorer');

    expect(spinnerStubs.stop.firstCall.args[0]).toBe('failed');
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    await expect(ConfigSet.run(['FOO=bar', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigSet.run([
      'STRIPE_KEY=sk_live_xyz789',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
      '--json',
    ]);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).toEqual({
      configVars: {STRIPE_KEY: 'sk_live_xyz789'},
      name: 'CreditRatingScorer',
      release: 11,
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const patchCall = findConfigVarsCall(requestStub, 'PATCH');
      expect(proxyTarget((patchCall![0] as {url: string}).url)).toBe(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
      );
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.computeApp-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-set-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.computeApp-meta.xml'), '<ComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-set-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await ConfigSet.run(['STRIPE_KEY=sk_live_xyz789', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain("Couldn't determine which compute app to use");

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });
});
