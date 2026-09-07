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

// Mirrors logs.test.ts/build/output.test.ts's findLogSessionCall -- Org.create()/getConnection()
// issues its own request through the same shared requestStub while resolving --target-org, so
// callCount/called on the stub itself is unreliable.
function findFormationCall(stub: sinon.SinonStub): sinon.SinonSpyCall | undefined {
  return stub
    .getCalls()
    .find(
      (call) =>
        (call.args[0] as { url?: string } | undefined)?.url?.startsWith('/connect/compute/') &&
        (call.args[0] as { url?: string } | undefined)?.url?.includes('/formation/')
    );
}

describe('compute scale', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: sinon.SinonStub;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
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

  it('scales dyno size via the Connect API by default', async () => {
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
    const call = findFormationCall(requestStub);
    expect(call, 'expected a PATCH to /connect/compute/{app}/formation/{type}').to.not.be.undefined;
    const request = call!.args[0] as { method: string; url: string; body: string };
    expect(request.method).to.equal('PATCH');
    expect(request.url).to.equal('/connect/compute/CreditRatingScorer/formation/web');
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse(request.body)).to.deep.equal({ dyno_size: { name: 'dyno-1c-4gb' } });
  });

  it('accepts a mixed-case size and normalizes it to lowercase before sending', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-1c-4gb' }, quantity: 1 });
    /* eslint-enable camelcase */

    await Scale.run(['web:DYNO-1C-4GB', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub);
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ dyno_size: { name: 'dyno-1c-4gb' } });
  });

  it('rejects the whole invocation, without calling the Connect API for any target, when one of several targets has an invalid size', async () => {
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

  it('scales quantity (including 0) via the Connect API', async () => {
    requestStub.resolves({ type: 'worker', quantity: 0 });

    const result = await Scale.run(['worker=0', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      formation: [{ type: 'worker', dynoSize: undefined, quantity: 0 }],
    });
    const call = findFormationCall(requestStub);
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({ quantity: 0 });
  });

  it('scales dyno size and quantity together via the Connect API', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.resolves({ type: 'web', dyno_size: { name: 'dyno-4c-16gb' }, quantity: 2 });
    /* eslint-enable camelcase */

    await Scale.run(['web=2:dyno-4c-16gb', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub);
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse((call!.args[0] as { body: string }).body)).to.deep.equal({
      dyno_size: { name: 'dyno-4c-16gb' },
      quantity: 2,
    });
    /* eslint-enable camelcase */
  });

  it('scales multiple process types in one invocation, one Connect call per type', async () => {
    // Org.create()/getConnection() issues its own request through this same shared stub while
    // resolving --target-org (see findFormationCall's comment) -- route by URL substring rather
    // than call index so that unrelated call doesn't shift which response goes to which PATCH.
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    requestStub.callsFake(async (req: { url?: string }) => {
      if (req.url?.endsWith('/formation/web')) {
        return { type: 'web', dyno_size: { name: 'dyno-4c-16gb' }, quantity: 2 };
      }
      if (req.url?.endsWith('/formation/worker')) {
        return { type: 'worker', dyno_size: { name: 'dyno-1c-0.5gb' }, quantity: 1 };
      }
      return { type: 'connect-api-path-not-used', quantity: 0 };
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

  it('accepts a PlatformComputeApp Id in place of a DeveloperName for --name', async () => {
    await Scale.run(['web=1', '--name', '0abEE0000004CqYYAU', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub);
    expect(call!.args[0]).to.have.property('url', '/connect/compute/0abEE0000004CqYYAU/formation/web');
  });

  it('rejects when no targets are given, without calling the Connect API', async () => {
    try {
      await Scale.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Specify at least one process type to scale');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  // --name is never joined into a filesystem path (unlike other commands' --name), so a
  // hyphenated value -- invalid as a DeveloperName, but a shape Heroku app Ids/names commonly
  // take -- must pass through untouched rather than being rejected by a path-traversal guard.
  it('passes a hyphenated --name through untouched to the Connect API call', async () => {
    await Scale.run(['web=1', '--name', 'my-heroku-style-app', '--target-org', testOrg.username]);

    const call = findFormationCall(requestStub);
    expect(call!.args[0]).to.have.property('url', '/connect/compute/my-heroku-style-app/formation/web');
  });

  it('rejects a malformed target, without calling the Connect API', async () => {
    try {
      await Scale.run(['web@2', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"web@2" isn\'t a valid scale target');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('rejects a target with neither a count nor a size, without calling the Connect API', async () => {
    try {
      await Scale.run(['web', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('"web" doesn\'t specify a count or size');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('rejects an invalid size, without calling the Connect API', async () => {
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

  it('wraps a Connect API failure as error.formationUpdateFailed', async () => {
    requestStub.rejects(new Error('socket hang up'));

    try {
      await Scale.run(['web=1', '--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't update the compute app's dyno formation: socket hang up");
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
      const call = findFormationCall(requestStub);
      expect(call!.args[0]).to.have.property('url', '/connect/compute/CreditRatingScorer/formation/web');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  // Mirrors the explicit-flag "passes a hyphenated --name through untouched" test above --
  // scale.ts's fallback-resolution line skips validateName just like the explicit-flag path, so a
  // hyphenated Heroku-style name reaching Scale via COMPUTE_APP_NAME must also pass through untouched.
  it('passes a hyphenated COMPUTE_APP_NAME through untouched, without validation', async () => {
    process.env.COMPUTE_APP_NAME = 'my-heroku-style-app';
    try {
      const result = await Scale.run(['web=1', '--target-org', testOrg.username]);
      expect(result.name).to.equal('my-heroku-style-app');
      const call = findFormationCall(requestStub);
      expect(call!.args[0]).to.have.property('url', '/connect/compute/my-heroku-style-app/formation/web');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
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

describe('compute scale with HEROKU_API_TOKEN set', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let requestStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    // Distinct from the Heroku formation call below so a stray Connect call is easy to notice.
    requestStub = sinon.stub().resolves({ type: 'connect-api-path-not-used', quantity: 0 });
    $$.fakeConnectionRequest = requestStub;

    process.env.HEROKU_API_TOKEN = 'shh-secret-token';
    fetchStub = $$.SANDBOX.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
    process.exitCode = 0;
    $$.restore();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('scales via Heroku directly, using --name as the Heroku app Id/name, without calling Connect', async () => {
    /* eslint-disable camelcase -- dyno_size is Heroku's Formation field name */
    fetchStub.resolves(jsonResponse({ type: 'web', quantity: 2, dyno_size: { id: 'sz1', name: 'Dyno-2C-8GB' } }));
    /* eslint-enable camelcase */

    const result = await Scale.run(['web=2:dyno-2c-8gb', '--name', 'my-heroku-app', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'my-heroku-app',
      formation: [{ type: 'web', dynoSize: 'Dyno-2C-8GB', quantity: 2 }],
    });
    expect(findFormationCall(requestStub)).to.be.undefined;
    const request = fetchStub.firstCall.args[0] as Request;
    expect(request.url).to.equal('https://api.heroku.com/apps/my-heroku-app/formation/web');
  });

  it('surfaces error.herokuFormationNotFound when Heroku 404s the app or process type', async () => {
    fetchStub.resolves(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));

    try {
      await Scale.run(['web=1', '--name', 'missing-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('missing-app');
      expect((e as Error).message).to.include('web');
    }
    expect(findFormationCall(requestStub)).to.be.undefined;
  });

  it('surfaces error.herokuAuthFailed (with the fallback-aware actions) on a 401/403, never leaking the token', async () => {
    fetchStub.resolves(new Response('forbidden', { status: 403 }));

    try {
      await Scale.run(['web=1', '--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('rejected the request');
      expect((e as Error).message).to.not.include('shh-secret-token');
    }
  });

  it('surfaces error.herokuApiRequestFailed on any other Heroku failure', async () => {
    fetchStub.resolves(new Response('server error', { status: 500 }));

    try {
      await Scale.run(['web=1', '--name', 'my-heroku-app', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't reach the Heroku Platform API");
    }
  });
});
