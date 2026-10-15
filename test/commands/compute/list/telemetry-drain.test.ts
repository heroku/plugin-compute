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

import TelemetryDrainList from '../../../../src/commands/compute/list/telemetry-drain.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors herokuProxyRequest's
// proxyUrl construction (see config/get.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

function findDrainsCall(stub: Mock): undefined | unknown[] {
  return stub.mock.calls.find(call => {
    const req = call[0] as undefined | {url?: string};
    return req?.url !== undefined && proxyTarget(req.url).endsWith('/telemetry-drains');
  });
}

const APP_ID = 'a1b2c3d4-heroku-app-id';

const computeAppRecord = {
  CurrentBuild: null,
  Description: null,
  DeveloperName: 'CreditRatingScorer',
  ExternalAppIdentifier: APP_ID,
  ExternalServiceRegistration: null,
  Id: '0abEE0000004CqYYAU',
  MasterLabel: 'Credit Rating Scorer',
  Status: 'ACTIVE',
  StatusReason: null,
};

const drainsFixture = [
  {id: 'drain-1', signals: ['traces', 'logs'], exporter: {type: 'otlp', endpoint: 'https://c1.example.com:4317'}},
  {id: 'drain-2', signals: [], exporter: {}},
];

describe('compute list telemetry-drain', () => {
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

    requestStub = vi.fn().mockResolvedValue(drainsFixture);
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('renders an ID/Signals/Endpoint table for an app that has drains', async () => {
    await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(sfCommandStubs.styledHeader.calledWith('CreditRatingScorer Telemetry Drains')).toBe(true);
    const [{columns, data}] = sfCommandStubs.table.firstCall.args as [{columns: string[]; data: unknown[]}];
    expect(columns).toEqual(['id', 'signals', 'endpoint']);
    expect(data).toEqual([
      {id: 'drain-1', signals: 'traces, logs', endpoint: 'https://c1.example.com:4317'},
      {id: 'drain-2', signals: '-', endpoint: '-'},
    ]);
  });

  it('keeps signals as a string[] in the result but joins them for the table cell', async () => {
    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.drains[0].signals).toEqual(['traces', 'logs']);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{signals: string}>}];
    expect(data[0].signals).toBe('traces, logs');
  });

  it('leaves result.endpoint undefined and renders a dash for a drain with no endpoint/signals', async () => {
    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.drains[1]).toEqual({id: 'drain-2', signals: [], endpoint: undefined});
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{endpoint: string; signals: string}>}];
    expect(data[1]).toMatchObject({signals: '-', endpoint: '-'});
  });

  it('sorts drains alphabetically by endpoint in both the result and the table, regardless of API order', async () => {
    requestStub.mockResolvedValue([
      {id: 'z', signals: ['logs'], exporter: {endpoint: 'https://zeta.example.com'}},
      {id: 'a', signals: ['logs'], exporter: {endpoint: 'https://alpha.example.com'}},
      {id: 'm', signals: ['logs'], exporter: {endpoint: 'https://mu.example.com'}},
    ]);

    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.drains.map(d => d.id)).toEqual(['a', 'm', 'z']);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{id: string}>}];
    expect(data.map(r => r.id)).toEqual(['a', 'm', 'z']);
  });

  it('sorts drains with no endpoint last, tiebreaking by id', async () => {
    requestStub.mockResolvedValue([
      {id: 'no-endpoint-b', signals: ['logs'], exporter: {}},
      {id: 'has-endpoint', signals: ['logs'], exporter: {endpoint: 'https://alpha.example.com'}},
      {id: 'no-endpoint-a', signals: ['logs'], exporter: {}},
    ]);

    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    // Endpoint-less drains collect at the bottom (matching the dash convention), ordered by id.
    expect(result.drains.map(d => d.id)).toEqual(['has-endpoint', 'no-endpoint-a', 'no-endpoint-b']);
  });

  it('tiebreaks drains that share an endpoint by id, deterministically', async () => {
    requestStub.mockResolvedValue([
      {id: 'drain-b', signals: ['logs'], exporter: {endpoint: 'https://shared.example.com'}},
      {id: 'drain-a', signals: ['logs'], exporter: {endpoint: 'https://shared.example.com'}},
    ]);

    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.drains.map(d => d.id)).toEqual(['drain-a', 'drain-b']);
  });

  it('omits id from the result but renders a dash in the table when Heroku returns a drain without one', async () => {
    requestStub.mockResolvedValue([{signals: ['logs'], exporter: {endpoint: 'https://x'}}]);

    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    // --json must not leak the display dash into the machine-readable id (it isn't addressable by get).
    expect(result.drains[0].id).toBeUndefined();
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{id: string}>}];
    expect(data[0].id).toBe('-');
  });

  it('shows the empty-state info message and returns {name, drains: []} when the app has no drains', async () => {
    requestStub.mockResolvedValue([]);

    const result = await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).toEqual({name: 'CreditRatingScorer', drains: []});
    expect(sfCommandStubs.styledHeader.called).toBe(false);
    expect(sfCommandStubs.table.called).toBe(false);
    expect(sfCommandStubs.info.firstCall.args[0]).toBe('No telemetry drains are configured for CreditRatingScorer.');
  });

  it('GETs the app telemetry-drains path through the proxy', async () => {
    await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const call = findDrainsCall(requestStub);
    expect(call).toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe(`https://api.heroku.com/apps/${APP_ID}/telemetry-drains`);
    expect((call![0] as {method: string}).method).toBe('GET');
  });

  it('returns the flattened {name, drains} result under --json, with structured signals', async () => {
    await TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--json']);

    const jsonOutput = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};
    expect(jsonOutput.result).toEqual({
      name: 'CreditRatingScorer',
      drains: [
        {id: 'drain-1', signals: ['traces', 'logs'], endpoint: 'https://c1.example.com:4317'},
        {id: 'drain-2', signals: [], endpoint: undefined},
      ],
    });
  });

  it('resolves --name from COMPUTE_APP_NAME when --name is not passed', async () => {
    process.env.COMPUTE_APP_NAME = 'CreditRatingScorer';
    try {
      const result = await TelemetryDrainList.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      delete process.env.COMPUTE_APP_NAME;
    }
  });

  it("resolves --name from the cwd's <name>.compute-meta.xml when --name and COMPUTE_APP_NAME are both absent", async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-td-list-'));
    const appDir = join(tmp, 'CreditRatingScorer');
    await mkdir(appDir);
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    process.chdir(appDir);
    try {
      const result = await TelemetryDrainList.run(['--target-org', testOrg.username]);
      expect(result.name).toBe('CreditRatingScorer');
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }
  });

  it('throws error.cannotResolveAppName when --name, COMPUTE_APP_NAME, and directory detection all fail', async () => {
    const originalCwd = process.cwd();
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-compute-td-list-empty-'));
    process.chdir(tmp);
    try {
      await expect(TelemetryDrainList.run(['--target-org', testOrg.username])).rejects.toThrow(
        "Couldn't determine which compute app to use",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, {force: true, recursive: true});
    }

    expect(findDrainsCall(requestStub)).toBeUndefined();
  });

  it('rejects a hyphenated --name before querying or calling the Heroku proxy', async () => {
    await expect(
      TelemetryDrainList.run(['--name', 'my-heroku-style-app', '--target-org', testOrg.username]),
    ).rejects.toThrow("isn't valid");

    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(findDrainsCall(requestStub)).toBeUndefined();
  });

  it('throws error.herokuAppIdentifierUnavailable when the app has no ExternalAppIdentifier yet, without proxying', async () => {
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{...computeAppRecord, ExternalAppIdentifier: undefined}],
      totalSize: 1,
    });

    await expect(
      TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow("doesn't have a Heroku app identifier yet");

    expect(findDrainsCall(requestStub)).toBeUndefined();
  });

  it('surfaces error.herokuAppNotFound when Heroku 404s the app', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}}));

    await expect(
      TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow('CreditRatingScorer');
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));

    await expect(
      TelemetryDrainList.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow('The Salesforce Heroku API proxy rejected the request: bad proxy_url');
  });
});
