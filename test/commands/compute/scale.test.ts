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

import Scale from '../../../src/commands/compute/scale.js';

// Every proxy-bound request lands on the same /services/data/vXX.0/heroku/proxy path with the
// real Heroku target URL percent-encoded into the proxy_url query param -- decode it to inspect
// which Heroku path/app/type a given call actually targeted, mirroring how herokuProxyRequest
// builds it in herokuProxyApi.ts.
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

// Mirrors logs.test.ts/build/output.test.ts's findLogSessionCall -- Org.create()/getConnection()
// issues its own request through the same shared requestStub while resolving --target-org, so
// callCount/called on the stub itself is unreliable.
function findFormationCall(stub: Mock, method?: string): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {method?: string; url?: string};
    if (!req?.url) {
      return false;
    }

    return proxyTarget(req.url).includes('/formation/') && (!method || req.method === method);
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

describe('compute scale', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: Mock;
  let toolingQueryStub: MockInstance;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    toolingQueryStub.mockResolvedValue({done: true, records: [computeAppRecord], totalSize: 1});
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({dyno_size: {name: 'dyno-1c-4gb'}, quantity: 2, type: 'web'});

    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    // SfCommand.catch() sets process.exitCode on every thrown error and nothing resets it --
    // without this, an error test earlier in the file leaks a nonzero status into a later
    // --json test's envelope.
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('scales dyno size via the Heroku proxy by default', async () => {
    requestStub.mockResolvedValue({dyno_size: {name: 'dyno-1c-4gb'}, quantity: 1, type: 'web'});

    const result = await Scale.run([
      'web:dyno-1c-4gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({
      formation: [{dynoSize: 'dyno-1c-4gb', quantity: 1, type: 'web'}],
      name: 'CreditRatingScorer',
    });
    const call = findFormationCall(requestStub, 'PATCH');
    expect(call, 'expected a PATCH proxied to Heroku formation').toBeDefined();
    const request = call![0] as {body: string; method: string; url: string};
    expect(proxyTarget(request.url)).toBe('https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/formation/web');

    expect(JSON.parse(request.body)).toEqual({dyno_size: {name: 'dyno-1c-4gb'}});
  });

  it('accepts a mixed-case size and normalizes it to lowercase before sending', async () => {
    requestStub.mockResolvedValue({dyno_size: {name: 'dyno-1c-4gb'}, quantity: 1, type: 'web'});

    await Scale.run(['web:DYNO-1C-4GB', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub, 'PATCH');

    expect(JSON.parse((call![0] as {body: string}).body)).toEqual({dyno_size: {name: 'dyno-1c-4gb'}});
  });

  it('rejects the whole invocation, without calling the Heroku proxy for any target, when one of several targets has an invalid size', async () => {
    await expect(
      Scale.run([
        'web=2:dyno-4c-16gb',
        'worker:xl',
        '--name',
        'CreditRatingScorer',
        '--target-org',
        testOrg.username,
      ]),
    ).rejects.toThrow('"xl" is not a valid size');

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('accepts a size containing a decimal point (Classic dyno-1c-0.5gb)', async () => {
    requestStub.mockResolvedValue({dyno_size: {name: 'dyno-1c-0.5gb'}, quantity: 1, type: 'web'});

    const result = await Scale.run([
      'web:dyno-1c-0.5gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.formation).toEqual([{dynoSize: 'dyno-1c-0.5gb', quantity: 1, type: 'web'}]);
  });

  it('scales quantity (including 0) via the Heroku proxy', async () => {
    requestStub.mockResolvedValue({quantity: 0, type: 'worker'});

    const result = await Scale.run(['worker=0', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({
      formation: [{dynoSize: undefined, quantity: 0, type: 'worker'}],
      name: 'CreditRatingScorer',
    });
    const call = findFormationCall(requestStub, 'PATCH');
    expect(JSON.parse((call![0] as {body: string}).body)).toEqual({quantity: 0});
  });

  it('scales dyno size and quantity together via the Heroku proxy', async () => {
    requestStub.mockResolvedValue({dyno_size: {name: 'dyno-4c-16gb'}, quantity: 2, type: 'web'});

    await Scale.run(['web=2:dyno-4c-16gb', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub, 'PATCH');

    expect(JSON.parse((call![0] as {body: string}).body)).toEqual({
      dyno_size: {name: 'dyno-4c-16gb'},
      quantity: 2,
    });
  });

  it('scales multiple process types in one invocation, one proxy call per type', async () => {
    // Org.create()/getConnection() issues its own request through this same shared stub while
    // resolving --target-org (see findFormationCall's comment) -- route by target substring
    // rather than call index so that unrelated call doesn't shift which response goes to which PATCH.

    requestStub.mockImplementation(async (req: {url?: string}) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/formation/web')) {
        return {dyno_size: {name: 'dyno-4c-16gb'}, quantity: 2, type: 'web'};
      }

      if (target.endsWith('/formation/worker')) {
        return {dyno_size: {name: 'dyno-1c-0.5gb'}, quantity: 1, type: 'worker'};
      }

      return {quantity: 0, type: 'heroku-proxy-path-not-used'};
    });

    const result = await Scale.run([
      'web=2:dyno-4c-16gb',
      'worker=1:dyno-1c-0.5gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).toEqual({
      formation: [
        {dynoSize: 'dyno-4c-16gb', quantity: 2, type: 'web'},
        {dynoSize: 'dyno-1c-0.5gb', quantity: 1, type: 'worker'},
      ],
      name: 'CreditRatingScorer',
    });
  });

  it('rejects when no targets are given, without calling the Heroku proxy', async () => {
    await expect(Scale.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username])).rejects.toThrow(
      'Specify at least one process type to scale',
    );

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  // Now that scale.ts always pre-flights a SOQL lookup by DeveloperName before proxying to
  // Heroku, --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected
  // by validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    await expect(
      Scale.run(['web=1', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]),
    ).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    await expect(
      Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('rejects a malformed target, without calling the Heroku proxy', async () => {
    await expect(
      Scale.run(['web@2', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow('"web@2" isn\'t a valid scale target');

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('rejects a target with neither a count nor a size, without calling the Heroku proxy', async () => {
    await expect(
      Scale.run(['web', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow('"web" doesn\'t specify a count or size');

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('rejects an invalid size, without calling the Heroku proxy', async () => {
    let error: Error | undefined;
    try {
      await Scale.run(['web:xl', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('"xl" is not a valid size');
    expect(error?.message).toContain(
      'dyno-1c-0.5gb, dyno-2c-1gb, dyno-1c-4gb, dyno-2c-8gb, dyno-4c-16gb, dyno-8c-32gb, dyno-16c-64gb, '
        + 'dyno-2c-4gb, dyno-4c-8gb, dyno-8c-16gb, dyno-16c-32gb, dyno-32c-64gb, dyno-1c-8gb, dyno-2c-16gb, '
        + 'dyno-4c-32gb, dyno-8c-64gb, dyno-16c-128gb',
    );

    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it('surfaces error.herokuFormationNotFound when Heroku 404s the app or process type', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    let error: Error | undefined;
    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('CreditRatingScorer');
    expect(error?.message).toContain('web');
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));

    await expect(
      Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(
      Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow("Couldn't reach the Heroku Platform API through Salesforce: socket hang up");
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    requestStub.mockResolvedValue({dyno_size: {name: 'dyno-1c-4gb'}, quantity: 1, type: 'web'});

    await Scale.run(['web:dyno-1c-4gb', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).toEqual({
      formation: [{dynoSize: 'dyno-1c-4gb', quantity: 1, type: 'web'}],
      name: 'CreditRatingScorer',
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
      const call = findFormationCall(requestStub, 'PATCH');
      expect(proxyTarget((call![0] as {url: string}).url)).toBe(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/formation/web',
      );
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  // Mirrors the explicit-flag "rejects a hyphenated --name" test above -- scale.ts's
  // fallback-resolution line now runs through the same validateName call as the explicit-flag
  // path, so a hyphenated Heroku-style name reaching Scale via COMPUTE_APP_NAME is rejected too.
  it('rejects a hyphenated COMPUTE_APP_NAME before querying or calling the Heroku proxy', async () => {
    process.env.COMPUTE_APP_NAME = 'my-heroku-style-app';
    let error: Error | undefined;
    try {
      await Scale.run(['web=1', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain("isn't valid");
    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findFormationCall(requestStub)).toBeUndefined();
  });

  it("resolves --name from the current directory's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-scale-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-scale-empty-'));
    process.chdir(tmp);
    let error: Error | undefined;
    try {
      await Scale.run(['web=1', '--target-org', testOrg.username]);
    } catch (error_) {
      error = error_ as Error;
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain("Couldn't determine which compute app to use");
    expect(findFormationCall(requestStub)).toBeUndefined();
  });
});
