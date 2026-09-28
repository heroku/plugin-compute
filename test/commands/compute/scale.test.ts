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
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
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
function findFormationCall(stub: sinon.SinonStub, method?: string): sinon.SinonSpyCall | undefined {
  return stub.getCalls().find((call) => {
    const req = call.args[0] as { url?: string; method?: string } | undefined;
    if (!req?.url) {
      return false;
    }
    return proxyTarget(req.url).includes('/formation/') && (!method || req.method === method);
  });
}

const computeAppRecord = {
  Id: '0abEE0000004CqYYAU',
  DeveloperName: 'CreditRatingScorer',
  MasterLabel: 'Credit Rating Scorer',
  Description: null,
  Status: 'ACTIVE',
  StatusReason: null,
  CurrentBuild: null,
  ExternalServiceRegistration: null,
  ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id',
};

describe('compute scale', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: sinon.SinonStub;
  let toolingQueryStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    toolingQueryStub.resolves({ totalSize: 1, records: [computeAppRecord], done: true });
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub = sinon.stub().resolves({ type: 'web', dyno_size: { name: 'dyno-1c-4gb' }, quantity: 2 });
    /* eslint-enable camelcase */
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    // SfCommand.catch() sets process.exitCode on every thrown error and nothing resets it --
    // without this, an error test earlier in the file leaks a nonzero status into a later
    // --json test's envelope.
    process.exitCode = 0;
    $$.restore();
  });

  it('scales dyno size via the Heroku proxy by default', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-1c-4gb' }, quantity: 1 });
    /* eslint-enable camelcase */

    const result = await Scale.run([
      'web:dyno-1c-4gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      formation: [{ type: 'web', dynoSize: 'dyno-1c-4gb', quantity: 1 }],
    });
    const call = findFormationCall(requestStub, 'PATCH');
    expect(call, 'expected a PATCH proxied to Heroku formation').to.not.be.undefined;
    const request = call!.args[0] as { method: string; url: string; body: string };
    expect(proxyTarget(request.url)).to.equal('https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/formation/web');
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse(request.body)).to.deep.equal({ dyno_size: { name: 'dyno-1c-4gb' } });
  });

  it('accepts a mixed-case size and normalizes it to lowercase before sending', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-1c-4gb' }, quantity: 1 });
    /* eslint-enable camelcase */

    await Scale.run(['web:DYNO-1C-4GB', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub, 'PATCH');
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ dyno_size: { name: 'dyno-1c-4gb' } });
  });

  it('rejects the whole invocation, without calling the Heroku proxy for any target, when one of several targets has an invalid size', async () => {
    try {
      await Scale.run([
        'web=2:dyno-4c-16gb',
        'worker:xl',
        '--name',
        'CreditRatingScorer',
        '--target-org',
        testOrg.username,
      ]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"xl" is not a valid size');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('accepts a size containing a decimal point (Classic dyno-1c-0.5gb)', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-1c-0.5gb' }, quantity: 1 });
    /* eslint-enable camelcase */

    const result = await Scale.run([
      'web:dyno-1c-0.5gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.formation).to.deep.equal([{ type: 'web', dynoSize: 'dyno-1c-0.5gb', quantity: 1 }]);
  });

  it('scales quantity (including 0) via the Heroku proxy', async () => {
    requestStub.resolves({ type: 'worker', quantity: 0 });

    const result = await Scale.run(['worker=0', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      formation: [{ type: 'worker', dynoSize: undefined, quantity: 0 }],
    });
    const call = findFormationCall(requestStub, 'PATCH');
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ quantity: 0 });
  });

  it('scales dyno size and quantity together via the Heroku proxy', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-4c-16gb' }, quantity: 2 });
    /* eslint-enable camelcase */

    await Scale.run(['web=2:dyno-4c-16gb', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub, 'PATCH');
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({
      dyno_size: { name: 'dyno-4c-16gb' },
      quantity: 2,
    });
    /* eslint-enable camelcase */
  });

  it('scales multiple process types in one invocation, one proxy call per type', async () => {
    // Org.create()/getConnection() issues its own request through this same shared stub while
    // resolving --target-org (see findFormationCall's comment) -- route by target substring
    // rather than call index so that unrelated call doesn't shift which response goes to which PATCH.
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.callsFake(async (req: { url?: string }) => {
      const target = req.url ? proxyTarget(req.url) : '';
      if (target.endsWith('/formation/web')) {
        return { type: 'web', dyno_size: { name: 'dyno-4c-16gb' }, quantity: 2 };
      }
      if (target.endsWith('/formation/worker')) {
        return { type: 'worker', dyno_size: { name: 'dyno-1c-0.5gb' }, quantity: 1 };
      }
      return { type: 'heroku-proxy-path-not-used', quantity: 0 };
    });
    /* eslint-enable camelcase */

    const result = await Scale.run([
      'web=2:dyno-4c-16gb',
      'worker=1:dyno-1c-0.5gb',
      '--name',
      'CreditRatingScorer',
      '--target-org',
      testOrg.username,
    ]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      formation: [
        { type: 'web', dynoSize: 'dyno-4c-16gb', quantity: 2 },
        { type: 'worker', dynoSize: 'dyno-1c-0.5gb', quantity: 1 },
      ],
    });
  });

  it('rejects when no targets are given, without calling the Heroku proxy', async () => {
    try {
      await Scale.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one process type to scale');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  // Now that scale.ts always pre-flights a SOQL lookup by DeveloperName before proxying to
  // Heroku, --name must be a valid DeveloperName -- a hyphenated Heroku-style value is rejected
  // by validateName rather than passed through, unlike before resolveHerokuAppId existed.
  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    try {
      await Scale.run(['web=1', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('throws error.herokuAppIdentifierUnavailable when the app resolves but has no ExternalAppIdentifier yet, without calling the proxy', async () => {
    toolingQueryStub.resolves({
      totalSize: 1,
      records: [{ ...computeAppRecord, ExternalAppIdentifier: undefined }],
      done: true,
    });

    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("doesn't have a Heroku app identifier yet");
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('rejects a malformed target, without calling the Heroku proxy', async () => {
    try {
      await Scale.run(['web@2', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"web@2" isn\'t a valid scale target');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('rejects a target with neither a count nor a size, without calling the Heroku proxy', async () => {
    try {
      await Scale.run(['web', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"web" doesn\'t specify a count or size');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('rejects an invalid size, without calling the Heroku proxy', async () => {
    try {
      await Scale.run(['web:xl', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"xl" is not a valid size');
      expect((e as Error).message).to.include(
        'dyno-1c-0.5gb, dyno-2c-1gb, dyno-1c-4gb, dyno-2c-8gb, dyno-4c-16gb, dyno-8c-32gb, dyno-16c-64gb, ' +
          'dyno-2c-4gb, dyno-4c-8gb, dyno-8c-16gb, dyno-16c-32gb, dyno-32c-64gb, dyno-1c-8gb, dyno-2c-16gb, ' +
          'dyno-4c-32gb, dyno-8c-64gb, dyno-16c-128gb'
      );
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('surfaces error.herokuFormationNotFound when Heroku 404s the app or process type', async () => {
    requestStub.rejects(Object.assign(new Error("Couldn't find that app."), { data: { id: 'not_found' } }));

    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('CreditRatingScorer');
      expect((e as Error).message).to.include('web');
    }
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.rejects(Object.assign(new Error('bad proxy_url'), { errorCode: 'HEROKU_PROXY_ERROR' }));

    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
    }
  });

  it('wraps an unrecognized proxy failure as error.herokuApiRequestFailed', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include(
        "Couldn't reach the Heroku Platform API through Salesforce: socket hang up"
      );
    }
  });

  it('returns the flattened result under --json, not the full status envelope', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-1c-4gb' }, quantity: 1 });
    /* eslint-enable camelcase */

    await Scale.run(['web:dyno-1c-4gb', '--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as { result: unknown };
    expect(jsonOutput.result).to.deep.equal({
      name: 'CreditRatingScorer',
      formation: [{ type: 'web', dynoSize: 'dyno-1c-4gb', quantity: 1 }],
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect(result.name).to.equal('CreditRatingScorer');
      const call = findFormationCall(requestStub, 'PATCH');
      expect(proxyTarget((call!.args[0] as { url: string }).url)).to.equal(
        'https://api.heroku.com/apps/a1b2c3d4-heroku-app-id/formation/web'
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
    try {
      await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
    expect(toolingQueryStub.called).to.be.false;
    expect(findFormationCall(requestStub)).to.be.undefined;
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
      expect(result.name).to.equal('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-scale-empty-'));
    process.chdir(tmp);
    try {
      await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't determine which compute app to use");
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });
});
