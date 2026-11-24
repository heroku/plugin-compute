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

import {Messages, SfdcUrl} from '@salesforce/core';

import {HEROKU_APP_ID_PATTERN} from './computeQuery.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// The Compute Dashboard is an LWR site. LWR routes are only served on the org's *Lightning*
// domain (e.g. https://<mydomain>.lightning.force.com); the My Domain host
// (https://<mydomain>.my.salesforce.com) answers "Page doesn't exist" for them.
export const DASHBOARD_PATH = '/lwr/application/heroku-compute_for_salesforce_dashboard';

// <label(s)>.my.<optional infix like "pc-rnd.">salesforce.com -- covers production, sandbox
// (x.sandbox.my.salesforce.com) and orgfarm (x.test1.my.pc-rnd.salesforce.com) hosts. URL
// hostnames are already lowercased, so no 'i' flag is needed.
const MY_DOMAIN_HOST = /^(?<prefix>.+?)\.my\.(?<infix>(?:[a-z0-9\-]+\.)*)salesforce\.com$/v;

// Converts an org instanceUrl (My Domain) to its Lightning origin. SfdcUrl.toLightningDomain()
// from @salesforce/core is correct for the standard shapes but collapses multi-label orgfarm
// hosts (x.test1.my.pc-rnd.salesforce.com -> x.lightning.force.com, which does not resolve; the
// real host is x.test1.lightning.pc-rnd.force.com). So: handle the my.<infix>salesforce.com family
// here, and delegate everything else (gov/mil, alternative, CN domains) to core.
export function toLightningOrigin(instanceUrl: string): string {
  const {hostname, origin} = new URL(instanceUrl);
  const match = MY_DOMAIN_HOST.exec(hostname);
  if (match?.groups) {
    return `https://${match.groups.prefix}.lightning.${match.groups.infix}force.com`;
  }

  return new SfdcUrl(origin).toLightningDomain();
}

// Control characters (incl. CR/LF), DEL and backslash are never valid in a dashboard route.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_ROUTE_CHARS = /[\u{0}-\u{1F}\u{7F}\\]/v;
const DRIVE_PATH = /^[a-z]:[\/\\]/iv;
const SCHEME = /^[a-z][a-z0-9+.\-]*:/iv;

// Validates and normalizes the optional [ROUTE] argument to a suffix for the app page URL.
// Policy: 'resources' and '/resources' are equivalent (a single leading '/' is added when
// missing); a route that is only a query or fragment ('?tab=logs', '#top') is appended as is; '/'
// means the app page itself (empty suffix). A route is a path only -- no scheme/host ('https://x', 'javascript:x'), no
// protocol-relative '//x', no backslashes, no control characters, not empty -- and may carry a
// query string and fragment. No allowlist of route names (routes change). The scheme and '//'
// rejections are a deliberate clear-error policy for ambiguous input (otherwise 'https://x' would
// become the path '/https://x'); they are not the security boundary. The actual guard is the
// origin and path-prefix check in joinDashboardRoute, which also catches '..' escapes.
export function normalizeDashboardRoute(route: string): string {
  if (
    route === ''
    || SCHEME.test(route)
    || route.startsWith('//')
    || FORBIDDEN_ROUTE_CHARS.test(route)
  ) {
    // Git Bash/MSYS rewrites an argument like /logs into C:/Program Files/Git/logs before we see it.
    throw DRIVE_PATH.test(route)
      ? messages.createError('error.invalidDashboardRouteDrivePath', [route])
      : messages.createError('error.invalidDashboardRoute', [route]);
  }

  if (route === '/') {
    return '';
  }

  return /^[?#]/v.test(route) || route.startsWith('/') ? route : `/${route}`;
}

// Appends a route to the dashboard base URL. Throws if '..' (or its %2e encodings) would resolve
// outside the base, e.g. /apps/<id>/../../other.
export function joinDashboardRoute(baseUrl: string, route: string): string {
  const normalized = normalizeDashboardRoute(route);
  const base = new URL(baseUrl);
  const joined = new URL(`${baseUrl}${normalized}`);
  const isWithinBase =
    joined.origin === base.origin
    && (joined.pathname === base.pathname || joined.pathname.startsWith(`${base.pathname}/`));
  if (!isWithinBase) {
    throw messages.createError('error.invalidDashboardRoute', [route]);
  }

  return joined.href;
}

// Full route validation (normalization plus the '..' escape check) without needing the real
// base, so a command can reject a bad route before querying the org. Whether a route escapes its
// base depends only on the route, not on how deep the base is.
export function validateDashboardRoute(route: string): void {
  joinDashboardRoute('https://placeholder.invalid/base', route);
}

// No app -> dashboard home. With an app (Heroku app id; the route accepts it) -> that app's page,
// plus an optional route (see normalizeDashboardRoute). A route is only meaningful with an app.
export function buildDashboardUrl(instanceUrl: string, app?: {herokuAppId: string; route?: string}): string {
  const base = `${toLightningOrigin(instanceUrl)}${DASHBOARD_PATH}`;
  if (!app) {
    return base;
  }

  // Heroku app ids are alphanumerics and hyphens; this also keeps '.'/'..' from forming the segment.
  if (!HEROKU_APP_ID_PATTERN.test(app.herokuAppId)) {
    throw messages.createError('error.invalidHerokuAppId', [app.herokuAppId]);
  }

  // The id is pattern-validated above (letters, digits, hyphens), so it needs no URL encoding.
  const appUrl = `${base}/apps/${app.herokuAppId}`;
  return app.route === undefined ? appUrl : joinDashboardRoute(appUrl, app.route);
}

// Org.getFrontDoorUrl() (singleaccess) rejects an absolute redirect_uri (Invalid_Param), so the
// frontdoor is minted with a relative path and lands on the My Domain host. Rewriting startURL to
// the absolute Lightning URL makes frontdoor.jsp establish the session and then continue to the
// Lightning domain (verified live: the response chains through /secur/contentDoor to the target).
export function withStartUrl(frontdoorUrl: string, targetUrl: string): string {
  const url = new URL(frontdoorUrl);
  url.searchParams.set('startURL', targetUrl);
  return url.href;
}

// The relative path to mint the frontdoor with (see withStartUrl).
export function toRelativePath(targetUrl: string): string {
  const {pathname, search} = new URL(targetUrl);
  return `${pathname}${search}`;
}
