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

import Config from '../../../src/commands/compute/config.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors
// herokuProxyRequest's proxyUrl construction in herokuProxyApi.ts.
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Mirrors scale.test.ts's findFormationCall -- Org.create()/getConnection() issues its own
// request through the same shared requestStub while resolving --target-org.
function findConfigVarsCall(stub: Mock, method?: string): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).endsWith('/config-vars') && (!method || req.method === method);
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

describe('compute config', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    toolingQueryStub.mockResolvedValue({done: true, records: [computeAppRecord], totalSize: 1});
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      LOG_LEVEL: 'info',
      STRIPE_KEY: 'sk_live_abc123',
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('lists config vars sorted alphabetically, aligned to the widest key', async () => {
    const result = await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({
      configVars: {
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        LOG_LEVEL: 'info',
        STRIPE_KEY: 'sk_live_abc123',
      },
      name: 'CreditRatingScorer',
    });
    expect(sfCommandStubs.styledHeader.firstCall.args[0]).toBe('CreditRatingScorer Config Vars');
    expect(sfCommandStubs.log.args.flat()).toEqual([
      'DATABASE_URL:  postgres://user:pass@host:5432/db',
      'LOG_LEVEL:     info',
      'STRIPE_KEY:    sk_live_abc123',
    ]);
    const call = findConfigVarsCall(requestStub, 'GET');
    expect(call, 'expected a GET proxied to Heroku config-vars').toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(
      'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
    );
  });

  it('prints only the header when there are no config vars', async () => {
    requestStub.mockResolvedValue({});

    const result = await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({configVars: {}, name: 'CreditRatingScorer'});
    expect(sfCommandStubs.log.called).toBe(false);
  });

  // Now that config.ts always pre-flights a SOQL lookup by DeveloperName before proxying to
  // Heroku, --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected
  // by validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    await expect(Config.run(['--name', 'my-heroku-style-app', '--target-org', testOrg.username])).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    await expect(Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findConfigVarsCall(requestStub)).toBeUndefined();
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    await expect(Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow('CreditRatingScorer');
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));

    await expect(Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
    );
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    await Config.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).toEqual({
      configVars: {
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        LOG_LEVEL: 'info',
        STRIPE_KEY: 'sk_live_abc123',
      },
      name: 'CreditRatingScorer',
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Config.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const call = findConfigVarsCall(requestStub, 'GET');
      expect(proxyTarget((call![0] as {url: string}).url)).toBe(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/config-vars',
      );
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
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-config-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await Config.run(['--target-org', testOrg.username]);
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
