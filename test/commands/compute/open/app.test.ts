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

import type {MockInstance} from 'vitest';

import {Org, type SfError} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
import {EventEmitter} from 'node:events';
import open, {apps} from 'open';

import OpenApp from '../../../../src/commands/compute/open/app.js';

vi.mock('open', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {...actual, default: vi.fn()};
});

describe('compute open app', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let frontdoorStub: MockInstance;
  let instanceUrl: string;
  const openMock = vi.mocked(open);

  const record = {
    CurrentBuild: null,
    Description: null,
    DeveloperName: 'CreditScoringApp',
    ExternalAppIdentifier: 'aaaa1111-bbbb-2222-cccc-333344445555',
    ExternalServiceRegistration: null,
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Credit Scoring',
    Status: 'ACTIVE',
    StatusReason: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    instanceUrl = 'https://mydomain.my.salesforce.com';
    vi.spyOn(connection, 'instanceUrl', 'get').mockReturnValue(instanceUrl);
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
    frontdoorStub = vi
      .spyOn(Org.prototype, 'getFrontDoorUrl')
      .mockResolvedValue('https://mydomain.my.salesforce.com/secur/frontdoor.jsp?otp=TOKEN&startURL=%2Flwr');
    vi.stubEnv('COMPUTE_APP_NAME', undefined);
    openMock.mockReset();
    openMock.mockResolvedValue({once: vi.fn()} as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    $$.restore();
    vi.restoreAllMocks();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.mockResolvedValue({done: true, records, totalSize: records.length});
  }

  const home = 'https://mydomain.lightning.force.com/lwr/application/heroku-compute_for_salesforce_dashboard';

  it('opens the app page on the Lightning domain via a frontdoor URL', async () => {
    resolveWith([record]);

    const result = await OpenApp.run(['--name', 'CreditScoringApp', '--target-org', testOrg.username]);

    const url = `${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555`;
    expect(result).toEqual({
      appId: 'aaaa1111-bbbb-2222-cccc-333344445555',
      appName: 'CreditScoringApp',
      orgId: testOrg.orgId,
      url,
    });
    expect(toolingQueryStub.mock.calls[0][0] as string).toContain("WHERE DeveloperName = 'CreditScoringApp'");
    expect(frontdoorStub).toHaveBeenCalledWith(
      '/lwr/application/heroku-compute_for_salesforce_dashboard/apps/aaaa1111-bbbb-2222-cccc-333344445555',
    );
    expect(openMock).toHaveBeenCalledTimes(1);
    const launched = new URL(openMock.mock.calls[0][0]);
    expect(launched.origin).toBe('https://mydomain.my.salesforce.com');
    expect(launched.searchParams.get('startURL')).toBe(url);
    expect(launched.searchParams.get('otp')).toBe('TOKEN');
    expect(openMock.mock.calls[0][1]).toEqual({});
    // The session token never reaches the user-visible log or result.
    const logged = sfCommandStubs.log.getCalls().flatMap(c => c.args).join('\n');
    expect(logged).not.toContain('TOKEN');
    expect(logged).toContain(url);
  });

  it('accepts -n and -b and passes the browser app through', async () => {
    resolveWith([record]);

    await OpenApp.run(['-n', 'CreditScoringApp', '-o', testOrg.username, '-b', 'firefox']);

    expect(openMock.mock.calls[0][1]).toEqual({app: {name: 'firefox'}});
  });

  it('opens the dashboard home with no --name and makes no query', async () => {
    const result = await OpenApp.run(['--target-org', testOrg.username]);

    expect(result.url).toBe(home);
    expect(result.appId).toBeUndefined();
    expect(result.appName).toBeUndefined();
    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(frontdoorStub).toHaveBeenCalledWith('/lwr/application/heroku-compute_for_salesforce_dashboard');
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it('uses COMPUTE_APP_NAME when --name is not given', async () => {
    resolveWith([record]);
    vi.stubEnv('COMPUTE_APP_NAME', 'CreditScoringApp');
    const result = await OpenApp.run(['--target-org', testOrg.username, '--url-only']);
    expect(result.url).toBe(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555`);
    expect(result.appName).toBe('CreditScoringApp');
    expect(toolingQueryStub.mock.calls[0][0] as string).toContain("WHERE DeveloperName = 'CreditScoringApp'");
  });

  it('--url-only prints the plain URL and neither launches a browser nor mints a frontdoor', async () => {
    resolveWith([record]);

    await OpenApp.run(['--name', 'CreditScoringApp', '--target-org', testOrg.username, '--url-only']);

    expect(openMock).not.toHaveBeenCalled();
    expect(frontdoorStub).not.toHaveBeenCalled();
    const logged = sfCommandStubs.log.getCalls().flatMap(c => c.args).join('\n');
    expect(logged).toContain(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555`);
    expect(logged).not.toContain('frontdoor');
  });

  it('--json does not launch a browser or mint a frontdoor', async () => {
    const result = await OpenApp.run(['--target-org', testOrg.username, '--json']);

    expect(result.url).toBe(home);
    expect(openMock).not.toHaveBeenCalled();
    expect(frontdoorStub).not.toHaveBeenCalled();
  });

  it('warns with the URL (and does not fail) when the browser cannot be launched', async () => {
    openMock.mockRejectedValue(new Error('no xdg-open'));

    const result = await OpenApp.run(['--target-org', testOrg.username]);

    expect(result.url).toBe(home);
    const warned = sfCommandStubs.warn.getCalls().map(c => (c.args[0] as string)).join('\n');
    expect(warned).toContain('no xdg-open');
    expect(warned).toContain(home);
  });

  it('throws when the app is not found', async () => {
    resolveWith([]);

    await expect(OpenApp.run(['--name', 'Missing', '--target-org', testOrg.username])).rejects.toMatchObject({
      name: 'AppNotFoundInOrgError',
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it('throws when the app has no Heroku app id yet', async () => {
    resolveWith([{...record, ExternalAppIdentifier: null}]);

    const error = await OpenApp.run(['--name', 'CreditScoringApp', '--target-org', testOrg.username]).catch(
      (error_: unknown) => error_ as SfError,
    );
    expect(error).toMatchObject({name: 'HerokuAppIdentifierUnavailableError'});
    expect((error as SfError).actions?.length).toBeGreaterThan(0);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid --name before querying', async () => {
    await expect(OpenApp.run(['--name', "bad'name", '--target-org', testOrg.username])).rejects.toMatchObject({
      name: 'InvalidNameError',
    });
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('appends ROUTE to the app page URL and keeps it through the frontdoor', async () => {
    resolveWith([record]);

    const result = await OpenApp.run(['/logs?tail=1', '--name', 'CreditScoringApp', '--target-org', testOrg.username]);

    const url = `${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555/logs?tail=1`;
    expect(result.url).toBe(url);
    expect(frontdoorStub).toHaveBeenCalledWith(
      '/lwr/application/heroku-compute_for_salesforce_dashboard/apps/aaaa1111-bbbb-2222-cccc-333344445555/logs?tail=1',
    );
    expect(new URL(openMock.mock.calls[0][0]).searchParams.get('startURL')).toBe(url);
  });

  it('normalizes a ROUTE without a leading slash', async () => {
    resolveWith([record]);

    const result = await OpenApp.run(['resources', '--name', 'CreditScoringApp', '--target-org', testOrg.username, '--url-only']);

    expect(result.url).toBe(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555/resources`);
  });

  it('rejects a ROUTE with no app name, before any query or browser launch', async () => {
    await expect(OpenApp.run(['/apps', '--target-org', testOrg.username])).rejects.toMatchObject({
      name: 'RouteRequiresNameError',
    });
    expect(toolingQueryStub).not.toHaveBeenCalled();
    expect(frontdoorStub).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('appends ROUTE to the --json url', async () => {
    resolveWith([record]);
    const result = await OpenApp.run(['/foo', '--name', 'CreditScoringApp', '--target-org', testOrg.username, '--json']);

    expect(result.url).toBe(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555/foo`);
    expect(openMock).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', '//evil.example', '/../x'])(
    'rejects invalid ROUTE %s before any query, frontdoor, or browser launch',
    async route => {
      await expect(
        OpenApp.run([route, '--name', 'CreditScoringApp', '--target-org', testOrg.username]),
      ).rejects.toMatchObject({name: 'InvalidDashboardRouteError'});
      expect(toolingQueryStub).not.toHaveBeenCalled();
      expect(frontdoorStub).not.toHaveBeenCalled();
      expect(openMock).not.toHaveBeenCalled();
    },
  );

  it('rejects --browser together with --url-only', async () => {
    await expect(
      OpenApp.run(['--target-org', testOrg.username, '--browser', 'chrome', '--url-only']),
    ).rejects.toThrow(/browser|url-only/v);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('warns with the plain URL, without throwing, when the launched process later emits an error', async () => {
    // eslint-disable-next-line unicorn/prefer-event-target -- mirrors the Node ChildProcess returned by open
    const subprocess = new EventEmitter();
    openMock.mockResolvedValue(subprocess as never);

    const result = await OpenApp.run(['--target-org', testOrg.username]);
    expect(result.url).toBe(home);
    expect(sfCommandStubs.warn.called).toBe(false);

    expect(() => subprocess.emit('error', new Error('spawn xdg-open ENOENT'))).not.toThrow();
    const warned = sfCommandStubs.warn.getCalls().map(c => c.args[0] as string).join('\n');
    expect(warned).toContain('spawn xdg-open ENOENT');
    expect(warned).toContain(home);
  });

  it.each(['sync', 'async'])('never leaks the frontdoor URL in a %s launch-failure warning', async mode => {
    const echoed = 'spawn failed: xdg-open https://mydomain.my.salesforce.com/secur/frontdoor.jsp?otp=TOKEN&startURL=x';
    if (mode === 'sync') {
      openMock.mockRejectedValue(new Error(echoed));
    } else {
      // eslint-disable-next-line unicorn/prefer-event-target -- mirrors the Node ChildProcess returned by open
      const subprocess = new EventEmitter();
      openMock.mockResolvedValue(subprocess as never);
      await OpenApp.run(['--target-org', testOrg.username]);
      subprocess.emit('error', new Error(echoed));
    }

    if (mode === 'sync') {
      await OpenApp.run(['--target-org', testOrg.username]);
    }

    const warned = sfCommandStubs.warn.getCalls().map(c => c.args[0] as string).join('\n');
    expect(warned).toContain(home);
    expect(warned).not.toContain('otp=TOKEN');
    expect(warned).not.toContain('frontdoor.jsp');
  });

  it('fails with the plain URL and actions when the frontdoor cannot be minted, and never launches', async () => {
    frontdoorStub.mockRejectedValue(new Error('INVALID_SESSION_ID'));
    let caught: SfError | undefined;
    try {
      await OpenApp.run(['--target-org', testOrg.username]);
    } catch (error) {
      caught = error as SfError;
    }

    expect(caught?.name).toBe('FrontdoorFailedError');
    expect(caught?.message).toContain(home);
    expect(caught?.message).toContain('INVALID_SESSION_ID');
    expect(caught?.actions?.join('\n')).toMatch(/--url-only/v);
    expect(caught?.actions?.join('\n')).toMatch(/sf org login web/v);
    expect(openMock).not.toHaveBeenCalled();
    expect(sfCommandStubs.log.getCalls().flatMap(c => c.args).join('\n')).toContain(home);
  });

  it('accepts a route when the app name comes only from COMPUTE_APP_NAME', async () => {
    vi.stubEnv('COMPUTE_APP_NAME', 'CreditScoringApp');
    resolveWith([record]);

    const result = await OpenApp.run(['--target-org', testOrg.username, 'resources']);

    expect(result.url).toBe(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555/resources`);
  });

  it('opens the home with no query when COMPUTE_APP_NAME is empty', async () => {
    vi.stubEnv('COMPUTE_APP_NAME', '');

    const result = await OpenApp.run(['--target-org', testOrg.username, '--url-only']);

    expect(result.url).toBe(home);
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('rejects an invalid COMPUTE_APP_NAME before querying', async () => {
    vi.stubEnv('COMPUTE_APP_NAME', "bad'name");

    await expect(OpenApp.run(['--target-org', testOrg.username, '--url-only'])).rejects.toMatchObject({
      name: 'InvalidNameError',
    });
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it.each(['..', 'a/b'])('rejects a malformed Heroku app id %j, also with --url-only', async id => {
    resolveWith([{...record, ExternalAppIdentifier: id}]);

    for (const extra of [[], ['--url-only']]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        OpenApp.run(['--name', 'CreditScoringApp', '--target-org', testOrg.username, ...extra]),
      ).rejects.toMatchObject({name: 'InvalidHerokuAppIdError'});
    }

    expect(openMock).not.toHaveBeenCalled();
    expect(frontdoorStub).not.toHaveBeenCalled();
  });

  it('fails to parse --browser together with --url-only without calling frontdoor or open', async () => {
    await expect(
      OpenApp.run(['--target-org', testOrg.username, '--browser', 'chrome', '--url-only']),
    ).rejects.toThrow();
    expect(frontdoorStub).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it.each(['chrome', 'edge', 'firefox'] as const)('maps --browser %s to the open package app name', async browser => {
    await OpenApp.run(['--target-org', testOrg.username, '--browser', browser]);

    expect(openMock.mock.calls[0][1]).toEqual({app: {name: apps[browser]}});
  });

  it.each([
    ['?tab=logs', '?tab=logs'],
    ['#top', '#top'],
    ['/', ''],
  ])('appends the query/fragment-only route %j without an extra slash', async (route, suffix) => {
    resolveWith([record]);

    const result = await OpenApp.run(['--name', 'CreditScoringApp', '--target-org', testOrg.username, '--url-only', route]);

    expect(result.url).toBe(`${home}/apps/aaaa1111-bbbb-2222-cccc-333344445555${suffix}`);
  });
});
