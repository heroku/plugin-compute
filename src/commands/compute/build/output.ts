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

import {Messages} from '@salesforce/core';
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';

import {requireAppName, resolveComputeAppNameFromDir, validateName} from '../../../shared/computeApp.js';
import {fetchBuildOutputStream} from '../../../shared/computeLogStream.js';
import {queryComputeApp, requireHerokuAppId, toComputeAppSummary} from '../../../shared/computeQuery.js';
import {fetchLatestBuildOutputStreamUrlViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.build.output');

export type ComputeBuildOutputResult = {
  buildStatus?: 'BUILDING' | 'FAILED' | 'PENDING' | 'SUCCEEDED';
  log?: string;
  name: string;
};

export default class Output extends SfCommand<ComputeBuildOutputResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
  };

  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeBuildOutputResult> {
    const {flags} = await this.parse(Output);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const {currentBuild} = toComputeAppSummary(record);

    if (!currentBuild) {
      this.info(messages.getMessage('info.noBuildsFound', [name]));
      return {name};
    }

    const {buildStatus} = currentBuild;
    const appId = requireHerokuAppId(record, name);
    const outputStreamUrl = await fetchLatestBuildOutputStreamUrlViaProxy(connection, {name, appId});

    if (outputStreamUrl === undefined) {
      this.info(messages.getMessage('info.buildOutputNotYetAvailable', [name, buildStatus]));
      return {name, buildStatus};
    }

    const log = await fetchBuildOutputStream(outputStreamUrl);
    this.log(log);
    return {name, buildStatus, log};
  }
}
