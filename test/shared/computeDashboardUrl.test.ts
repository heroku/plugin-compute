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
  buildDashboardUrl,
  DASHBOARD_PATH,
  joinDashboardRoute,
  normalizeDashboardRoute,
  toLightningOrigin,
  toRelativePath,
  validateDashboardRoute,
  withStartUrl,
} from '../../src/shared/computeDashboardUrl.js';

function attempt(fn: () => string): string {
  try {
    return fn();
  } catch {
    return 'THROWS';
  }
}

describe('computeDashboardUrl', () => {
  describe('toLightningOrigin', () => {
    it.each([
      ['https://mydomain.my.salesforce.com', 'https://mydomain.lightning.force.com'],
      ['https://mydomain.my.salesforce.com/', 'https://mydomain.lightning.force.com'],
      ['https://mydomain.my.salesforce.com/services/data', 'https://mydomain.lightning.force.com'],
      ['https://acme--dev.sandbox.my.salesforce.com', 'https://acme--dev.sandbox.lightning.force.com'],
      ['https://orgfarm-7e00b7c152.test1.my.pc-rnd.salesforce.com', 'https://orgfarm-7e00b7c152.test1.lightning.pc-rnd.force.com'],
      ['https://orgfarm-abc.my.pc-rnd.salesforce.com/', 'https://orgfarm-abc.lightning.pc-rnd.force.com'],
      ['https://MyDomain.MY.salesforce.com', 'https://mydomain.lightning.force.com'],
    ])('%s -> %s', (input, expected) => {
      expect(toLightningOrigin(input)).toBe(expected);
    });

    it('delegates non-my.salesforce.com hosts to @salesforce/core', () => {
      expect(toLightningOrigin('https://acme.my.salesforce.mil')).toBe('https://acme.lightning.crmforce.mil');
    });
  });

  describe('buildDashboardUrl', () => {
    it('returns the dashboard home with no app id', () => {
      expect(buildDashboardUrl('https://mydomain.my.salesforce.com/')).toBe(
        `https://mydomain.lightning.force.com${DASHBOARD_PATH}`,
      );
    });

    it('appends /apps/<id> with an app id, with no double slashes', () => {
      const url = buildDashboardUrl('https://mydomain.my.salesforce.com/', {herokuAppId: 'a1b2c3d4-0000-1111-2222-333344445555'});
      expect(url).toBe(
        'https://mydomain.lightning.force.com/lwr/application/heroku-compute_for_salesforce_dashboard/apps/a1b2c3d4-0000-1111-2222-333344445555',
      );
      expect(url.slice('https://'.length)).not.toContain('//');
    });

    it('uses the orgfarm Lightning host', () => {
      expect(buildDashboardUrl('https://orgfarm-1.test1.my.pc-rnd.salesforce.com', {herokuAppId: 'id1'})).toBe(
        `https://orgfarm-1.test1.lightning.pc-rnd.force.com${DASHBOARD_PATH}/apps/id1`,
      );
    });

    it.each(['..', '.', 'a/b', 'a?b', '', 'a b'])('rejects the Heroku app id %j', id => {
      expect(() => buildDashboardUrl('https://d.my.salesforce.com', {herokuAppId: id})).toThrow(/app identifier/v);
    });
  });

  describe('withStartUrl / toRelativePath', () => {
    const target = `https://d.lightning.force.com${DASHBOARD_PATH}/apps/x`;

    it('replaces startURL and preserves the other params', () => {
      const out = new URL(
        withStartUrl('https://d.my.salesforce.com/secur/frontdoor.jsp?otp=T&startURL=%2Fold&cshc=C', target),
      );
      expect(out.origin).toBe('https://d.my.salesforce.com');
      expect(out.searchParams.get('startURL')).toBe(target);
      expect(out.searchParams.get('otp')).toBe('T');
      expect(out.searchParams.get('cshc')).toBe('C');
    });

    it('adds startURL when absent', () => {
      expect(new URL(withStartUrl('https://d.my.salesforce.com/secur/frontdoor.jsp?otp=T', target)).searchParams.get('startURL')).toBe(target);
    });

    it('extracts the relative path', () => {
      expect(toRelativePath(target)).toBe(`${DASHBOARD_PATH}/apps/x`);
    });
  });

  describe('route argument', () => {
    const org = 'https://mydomain.my.salesforce.com';
    const lightning = `https://mydomain.lightning.force.com${DASHBOARD_PATH}`;

    it('appends a path to the app page', () => {
      expect(buildDashboardUrl(org, {herokuAppId: 'id1', route: '/logs'})).toBe(`${lightning}/apps/id1/logs`);
    });

    it('normalizes a missing leading slash', () => {
      expect(buildDashboardUrl(org, {herokuAppId: 'id1', route: 'resources'})).toBe(`${lightning}/apps/id1/resources`);
      expect(normalizeDashboardRoute('/resources')).toBe('/resources');
    });

    it('keeps query string and fragment', () => {
      expect(buildDashboardUrl(org, {herokuAppId: 'id1', route: '/logs?tail=1&x=a%20b#top'})).toBe(
        `${lightning}/apps/id1/logs?tail=1&x=a%20b#top`,
      );
    });

    it('allows .. that stays inside the base', () => {
      expect(joinDashboardRoute(`${lightning}/apps/id1`, '/a/../b')).toBe(`${lightning}/apps/id1/b`);
    });

    it('survives the frontdoor flow (relative path + startURL rewrite)', () => {
      const url = buildDashboardUrl(org, {herokuAppId: 'id1', route: '/logs?tail=1#top'});
      expect(toRelativePath(url)).toBe(`${DASHBOARD_PATH}/apps/id1/logs?tail=1`);
      const fd = new URL(withStartUrl('https://mydomain.my.salesforce.com/secur/frontdoor.jsp?otp=T', url));
      expect(fd.searchParams.get('startURL')).toBe(url);
    });

    it.each([
      ['empty', ''],
      ['https scheme', 'https://evil.example'],
      ['scheme no slashes', 'mailto:a@b.c'],
      ['protocol-relative', '//evil.example'],
      // eslint-disable-next-line no-script-url
      ['javascript scheme', 'javascript:alert(1)'],
      ['backslash', String.raw`/a\b`],
      ['backslash host', String.raw`/\evil.example`],
      ['LF', '/a\nb'],
      ['CR', '/a\rb'],
      ['NUL', '/a\u{0}b'],
      ['tab', '/a\tb'],
      ['DEL', '/a\u{7F}b'],
      ['escaping ..', '/../../other'],
      ['escaping ..  mid-path', '/a/../../../other'],
      ['encoded ..', '/%2e%2e/%2e%2e/other'],
      ['encoded ..  mixed', '/.%2e/other'],
    ])('rejects %s', (_label, path) => {
      expect(() => buildDashboardUrl(org, {herokuAppId: 'id1', route: path})).toThrow(/dashboard route/v);
    });

    it('normalizeDashboardRoute throws an SfError with actions', () => {
      let caught: unknown;
      try {
        normalizeDashboardRoute('//x');
      } catch (error) {
        caught = error;
      }

      expect((caught as {actions?: string[]}).actions?.length).toBeGreaterThan(0);
      expect((caught as Error).name).toBe('InvalidDashboardRouteError');
    });
  });

  describe('toLightningOrigin (current behavior pinned)', () => {
    it.each([
      ['https://acme-scratch.scratch.my.salesforce.com', 'https://acme-scratch.scratch.lightning.force.com'],
      ['https://acme-dev-ed.develop.my.salesforce.com', 'https://acme-dev-ed.develop.lightning.force.com'],
      ['https://acme.my.salesforce.com', 'https://acme.lightning.force.com'],
      ['https://acme--qa.sandbox.my.salesforce.com', 'https://acme--qa.sandbox.lightning.force.com'],
      ['https://orgfarm-1.test1.my.pc-rnd.salesforce.com', 'https://orgfarm-1.test1.lightning.pc-rnd.force.com'],
    ])('%s -> %s', (input, expected) => {
      expect(toLightningOrigin(input)).toBe(expected);
    });

    it.each(['https://acme.my-salesforce.com', 'https://acme.my.sfcrmproducts.cn'])('%s is whatever core returns', input => {
      const result = toLightningOrigin(input);
      expect(result).toMatch(/^https:\/\//v);
      expect(result).toBe(toLightningOrigin(input));
    });
  });

  describe('route edge cases', () => {
    const base = 'https://x.lightning.force.com/b/apps/id1';

    it.each([
      ['?x=1', `${base}?x=1`],
      ['#frag', `${base}#frag`],
      ['/', base],
      ['logs', `${base}/logs`],
      ['..%2f..', undefined],
      ['..%2F..', undefined],
      ['%2E%2E', undefined],
      ['.', undefined],
      ['a/..', undefined],
      ['/a/%2e%2e/b', `${base}/b`],
      ['a b', `${base}/a%20b`],
      ['caf\u{E9}', `${base}/caf%C3%A9`],
    ])('joins %j', (route, expected) => {
      const result = attempt(() => joinDashboardRoute(base, route));
      // undefined means: either rejected or confined within the app base; never outside it.
      const isConfined = result === 'THROWS' || result.startsWith(base);
      expect(expected === undefined ? isConfined : result === expected).toBe(true);
    });

    it('rejects the logs:tail style route as a scheme (intended)', () => {
      expect(() => normalizeDashboardRoute('logs:tail')).toThrow(/not valid/v);
    });

    it('gives a Git Bash hint for drive-letter paths', () => {
      expect(() => normalizeDashboardRoute('C:/Program Files/Git/logs')).toThrow(/Git Bash/v);
    });

    it.each([
      '',
      '/',
      'a',
      '/a',
      '?x',
      '#y',
      '..',
      '/..',
      '../x',
      'a/../..',
      'a/../b',
      '%2e%2e/%2e%2e/x',
      '/a/%2E%2E/%2E%2E/x',
      '//x',
      'https://x',
      String.raw`a\b`,
      'a\nb',
      '.',
      './x',
      '..%2f..',
      'a/%2e%2e',
      'logs:tail',
    ])('validateDashboardRoute matches joinDashboardRoute for %j', route => {
      const real = attempt(() => joinDashboardRoute('https://x.lightning.force.com/d/apps/deep/er/id1', route));
      const placeholder = attempt(() => {
        validateDashboardRoute(route);
        return 'OK';
      });
      const isRealThrows = real === 'THROWS';
      const isPlaceholderThrows = placeholder === 'THROWS';
      expect(isPlaceholderThrows).toBe(isRealThrows);
    });
  });
});
