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

import {Args} from '@oclif/core';
import {Messages} from '@salesforce/core';
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';
import open, {apps} from 'open';

import {validateName} from '../../../shared/computeApp.js';
import {
  buildDashboardUrl,
  toRelativePath,
  validateDashboardRoute,
  withStartUrl,
} from '../../../shared/computeDashboardUrl.js';
import {queryComputeApp, requireHerokuAppId} from '../../../shared/computeQuery.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.open.app');

const BROWSERS = ['chrome', 'edge', 'firefox'] as const;

// url is always the plain dashboard URL on the Lightning domain -- never the single-use
// frontdoor URL, so it is safe to log, share, and emit under --json.
export type ComputeOpenAppResult = {
  appId?: string;
  appName?: string;
  orgId: string;
  url: string;
};

// Defense in depth: Node spawn errors don't normally include argv, but some launchers do echo
// their arguments, and argv holds the single-use frontdoor URL (session token). Never surface
// that in a warning: replace any frontdoor URL fragment before showing the message.
function redactFrontdoor(message: string): string {
  return message.replaceAll(/\S*frontdoor\.jsp\S*/gv, '<frontdoor URL redacted>').replaceAll(/otp=\S*/gv, 'otp=<redacted>');
}

export default class OpenApp extends SfCommand<ComputeOpenAppResult> {
  public static readonly args = {
    route: Args.string({
      summary: messages.getMessage('args.route.summary'),
    }),
  };

  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    // Same definition as display.ts. Unlike display, no cwd-name fallback: with neither --name nor
    // COMPUTE_APP_NAME set, the command opens the dashboard home.
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
    browser: Flags.option({
      char: 'b',
      summary: messages.getMessage('flags.browser.summary'),
      exclusive: ['url-only'],
      options: BROWSERS,
    })(),
    'url-only': Flags.boolean({
      char: 'r',
      summary: messages.getMessage('flags.url-only.summary'),
    }),
  };

  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeOpenAppResult> {
    const {args, flags} = await this.parse(OpenApp);
    // Validated before any org query or browser launch. A route is only valid with an app.
    if (args.route !== undefined) {
      // flags.name already includes the COMPUTE_APP_NAME env value (oclif resolves `env:`).
      if (flags.name === undefined) {
        throw messages.createError('error.routeRequiresName');
      }

      validateDashboardRoute(args.route);
    }

    const org = flags['target-org'];
    const appName = flags.name;
    if (appName !== undefined) {
      validateName(appName);
    }

    const connection = org.getConnection(flags['api-version']);
    let appId: string | undefined;
    if (appName !== undefined) {
      const record = await queryComputeApp(connection, appName);
      appId = requireHerokuAppId(record, appName);
    }

    const url = buildDashboardUrl(
      connection.instanceUrl,
      appId === undefined ? undefined : {herokuAppId: appId, route: args.route},
    );
    const result: ComputeOpenAppResult = {
      url, orgId: org.getOrgId(), appName, appId,
    };

    // --json and --url-only never mint a frontdoor token and never launch a browser.
    if (flags['url-only'] || this.jsonEnabled()) {
      if (!this.jsonEnabled()) {
        this.log(url);
      }

      return result;
    }

    this.log(messages.getMessage('info.opening', [url]));
    let frontdoor: string;
    try {
      frontdoor = withStartUrl(await org.getFrontDoorUrl(toRelativePath(url)), url);
    } catch (error) {
      throw messages.createError('error.frontdoorFailed', [(error as Error).message, url]);
    }

    try {
      const subprocess = await open(frontdoor, flags.browser ? {app: {name: apps[flags.browser]}} : {});
      subprocess.once('error', (error: Error) => {
        this.warn(messages.getMessage('warning.browserLaunchFailed', [redactFrontdoor(error.message), url]));
      });
    } catch (error) {
      this.warn(messages.getMessage('warning.browserLaunchFailed', [redactFrontdoor((error as Error).message), url]));
    }

    return result;
  }
}
