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

import type {Mock} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';

import TelemetryDrainDelete from '../../../../src/commands/compute/delete/telemetry-drain.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors herokuProxyRequest's
// proxyUrl construction (see display/telemetry-drain.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

function findDeleteCall(stub: Mock): undefined | {method?: string; url: string} {
  const call = stub.mock.calls.find(c => {
    const req = c[0] as undefined | {method?: string; url?: string};
    return req?.method === 'DELETE' && req.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains/');
  });
  return call?.[0] as undefined | {method?: string; url: string};
}

const DRAIN_ID = '01234567-89ab-cdef-0123-456789abcdef';

describe('compute delete telemetry-drain', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: Mock;
  let confirmSpy: Mock;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({id: DRAIN_ID});
    $$.fakeConnectionRequest = requestStub;

    confirmSpy = vi.spyOn(TelemetryDrainDelete.prototype, 'confirm');
    confirmSpy.mockResolvedValue(true);
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('asks for confirmation, then DELETEs the drain', async () => {
    const result = await TelemetryDrainDelete.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect((confirmSpy.mock.calls[0][0] as {message: string}).message).toContain(DRAIN_ID);
    const del = findDeleteCall(requestStub);
    expect(del, 'expected a DELETE proxied to Heroku telemetry-drains').toBeDefined();
    expect(proxyTarget(del!.url)).toBe(`https://api.heroku.com/telemetry-drains/${DRAIN_ID}`);
    expect(result).toEqual({id: DRAIN_ID, deleted: true});
    expect(sfCommandStubs.logSuccess.firstCall.args[0]).toContain(DRAIN_ID);
  });

  it('does not delete when the user declines the confirmation', async () => {
    confirmSpy.mockResolvedValue(false);

    const result = await TelemetryDrainDelete.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(findDeleteCall(requestStub)).toBeUndefined();
    expect(result).toEqual({id: DRAIN_ID, deleted: false});
    expect(sfCommandStubs.logSuccess.called).toBe(false);
  });

  it('skips the prompt and deletes with --no-prompt', async () => {
    const result = await TelemetryDrainDelete.run([DRAIN_ID, '--no-prompt', '--target-org', testOrg.username]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(findDeleteCall(requestStub)).toBeDefined();
    expect(result).toEqual({id: DRAIN_ID, deleted: true});
  });

  it('skips the prompt under --json', async () => {
    const result = await TelemetryDrainDelete.run([DRAIN_ID, '--json', '--target-org', testOrg.username]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(findDeleteCall(requestStub)).toBeDefined();
    expect(result).toEqual({id: DRAIN_ID, deleted: true});
  });

  it('url-encodes the drain id in the request path', async () => {
    await TelemetryDrainDelete.run(['a/b c', '--no-prompt', '--target-org', testOrg.username]);

    expect(proxyTarget(findDeleteCall(requestStub)!.url)).toBe('https://api.heroku.com/telemetry-drains/a%2Fb%20c');
  });

  it('surfaces error.telemetryDrainNotFound and never reports success when Heroku 404s the drain id', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that."), {data: {id: 'not_found'}}));

    await expect(TelemetryDrainDelete.run([DRAIN_ID, '--no-prompt', '--target-org', testOrg.username])).rejects.toThrow(
      `Heroku didn't find a telemetry drain with ID ${DRAIN_ID}.`,
    );
    expect(sfCommandStubs.logSuccess.called).toBe(false);
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));

    await expect(TelemetryDrainDelete.run([DRAIN_ID, '--no-prompt', '--target-org', testOrg.username])).rejects.toThrow(
      'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
    );
    expect(sfCommandStubs.logSuccess.called).toBe(false);
  });

  it('wraps an unrecognized failure as error.herokuApiRequestFailed', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(TelemetryDrainDelete.run([DRAIN_ID, '--no-prompt', '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
    expect(sfCommandStubs.logSuccess.called).toBe(false);
  });

  it('accepts -p as the short form of --no-prompt', async () => {
    const result = await TelemetryDrainDelete.run([DRAIN_ID, '-p', '--target-org', testOrg.username]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result).toEqual({id: DRAIN_ID, deleted: true});
  });

  it('requires the drain id', async () => {
    await expect(TelemetryDrainDelete.run(['--target-org', testOrg.username])).rejects.toThrow(/id/iv);
  });
});
