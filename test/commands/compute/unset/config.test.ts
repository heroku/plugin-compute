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

import ConfigUnset from '../../../../src/commands/compute/unset/config.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts (see config.test.ts/scale.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// unset.ts makes three separate proxy calls: GET .../config-vars (existence check), PATCH
// .../config-vars (the actual unset), then GET .../releases (release number lookup) -- plus
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

describe('compute unset config', () => {
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

    requestStub = vi.fn().mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info', STRIPE_KEY: 'sk_live_abc123'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {STRIPE_KEY: 'sk_live_abc123'};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [{version: 10}];
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
    expect(ConfigUnset.hiddenAliases).toEqual(['compute:config:unset']);
    // Hidden, not visible: a visible alias would resurface the old id in --help/docs/snapshot.
    expect(ConfigUnset.aliases).toEqual([]);
    expect(ConfigUnset.deprecateAliases).toBe(true);
  });

  it('unsets a single key and reports the release version', async () => {
    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({name: 'CreditRatingScorer', release: 10, unset: ['LOG_LEVEL']});
    const configVarsGetCall = findConfigVarsCall(requestStub, 'GET');
    expect(configVarsGetCall, 'expected a GET proxied to Heroku config-vars').toBeDefined();
    expect(proxyTarget((configVarsGetCall![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
    );
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall![0] as {body: string}).body)).toEqual({LOG_LEVEL: null});
    expect(spinnerStubs.start.firstCall.args[0]).toBe('Unsetting LOG_LEVEL and restarting CreditRatingScorer');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done, v10');
    const releasesCall = findReleasesCall(requestStub, 'GET');
    expect(releasesCall, 'expected a GET proxied to Heroku releases').toBeDefined();
  });

  it('joins multiple keys with a plain comma when unsetting more than one', async () => {
    const result = await ConfigUnset.run([
      'STRIPE_KEY',
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({name: 'CreditRatingScorer', release: 10, unset: ['STRIPE_KEY', 'LOG_LEVEL']});
    const patchCall = findConfigVarsCall(requestStub, 'PATCH');
    expect(JSON.parse((patchCall![0] as {body: string}).body)).toEqual({
      LOG_LEVEL: null,
      STRIPE_KEY: null,
    });
    expect(spinnerStubs.start.firstCall.args[0]).toBe(
      'Unsetting STRIPE_KEY, LOG_LEVEL and restarting CreditRatingScorer',
    );
  });

  it('lists a key requested twice only once, and does not error as a duplicate', async () => {
    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.unset).toEqual(['LOG_LEVEL']);
  });

  it('errors on a key that was never set, without calling PATCH', async () => {
    let error: Error | undefined;
    try {
      await ConfigUnset.run(['MISSING', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toBe('CreditRatingScorer has no config var named "MISSING".');

    expect(findConfigVarsCall(requestStub, 'PATCH')).toBeUndefined();
  });

  it('rejects when no keys are given, without calling the Heroku proxy', async () => {
    await expect(ConfigUnset.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('Specify at least one config var to unset');

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  // Now that unset/config.ts always pre-flights a SOQL lookup by DeveloperName before proxying to
  // Heroku, --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected
  // by validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    await expect(ConfigUnset.run(['LOG_LEVEL', '--name', 'my-heroku-style-app', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    await expect(ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('omits release from the result when there are no releases yet', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        return [];
      }

      return {};
    });

    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({name: 'CreditRatingScorer', unset: ['LOG_LEVEL']});
    expect(result).not.toHaveProperty('release');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done');
  });

  it('omits release, but still succeeds, when the release lookup itself fails (best-effort)', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        return {};
      }

      if (target.endsWith('/releases') && req.method === 'GET') {
        throw new Error('socket hang up');
      }

      return {};
    });

    const result = await ConfigUnset.run([
      'LOG_LEVEL',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({name: 'CreditRatingScorer', unset: ['LOG_LEVEL']});
    expect(result).not.toHaveProperty('release');
    expect(spinnerStubs.stop.firstCall.args[0]).toBe('done');
  });

  it('wraps an unrecognized proxy failure from the PATCH as error.herokuApiRequestFailed', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw new Error('socket hang up');
      }

      return {};
    });

    await expect(ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );

    expect(spinnerStubs.stop.firstCall.args[0]).toBe('failed');
  });

  it('wraps a proxy-rejection failure from the PATCH as error.herokuProxyRequestFailed', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        return {LOG_LEVEL: 'info'};
      }

      if (target.endsWith('/config-vars') && req.method === 'PATCH') {
        throw Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'});
      }

      return {};
    });

    await expect(ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
    );

    expect(spinnerStubs.stop.firstCall.args[0]).toBe('failed');
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app on the existence-check GET', async () => {
    requestStub.mockImplementation(async (req: {method?: string; url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/config-vars') && req.method === 'GET') {
        throw Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}});
      }

      return {};
    });

    await expect(ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('CreditRatingScorer');
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await ConfigUnset.run(['LOG_LEVEL', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).toEqual({name: 'CreditRatingScorer', release: 10, unset: ['LOG_LEVEL']});
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const patchCall = findConfigVarsCall(requestStub, 'PATCH');
      expect(proxyTarget((patchCall![0] as {url: string}).url)).toBe(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
      );
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-unset-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-unset-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await ConfigUnset.run(['LOG_LEVEL', '--target-org', testOrg.username]);
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
