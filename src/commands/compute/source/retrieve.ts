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
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {pathExists, resolveAppDir, validateName} from '../../../shared/computeApp.js';
import {unpackComputeBundle} from '../../../shared/computeBundle.js';
import {downloadComputeSource} from '../../../shared/computeConnectApi.js';
import {retrieveComputeMetadata} from '../../../shared/metadataRetrieve.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.source.retrieve');

export type ComputeSourceRetrieveResult = {
  files: number;
  name: string;
  path: string;
};

export default class Retrieve extends SfCommand<ComputeSourceRetrieveResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      required: true,
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
    'output-dir': Flags.directory({
      char: 'd',
      summary: messages.getMessage('flags.output-dir.summary'),
      description: messages.getMessage('flags.output-dir.description'),
      default: 'force-app/main/default/computeApps',
    }),
  };

  public static readonly requiresProject = true;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeSourceRetrieveResult> {
    const {flags} = await this.parse(Retrieve);
    const {name} = flags;
    validateName(name);

    const appDir = resolveAppDir(flags['output-dir'], name);
    if (await pathExists(appDir)) {
      throw messages.createError('error.appAlreadyExists', [name, appDir]);
    }

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const username = connection.getUsername() ?? flags['target-org'].getUsername() ?? '<org>';
    this.log(messages.getMessage('info.retrieving', [name, username]));

    // Finish every network call before touching disk (as generate.ts does), so a failed retrieve
    // or download leaves nothing behind for a retry to trip over.
    const metadata = await retrieveComputeMetadata(connection, name);
    this.log(messages.getMessage('info.retrievedMetadata', [metadata.fileName]));

    this.log(messages.getMessage('info.downloadingSource'));
    const bundle = await downloadComputeSource(connection, {appIdOrName: name});

    // appDir didn't exist when we checked above, so anything in it is ours: remove it if the
    // writes fail partway (e.g. out of disk space), otherwise a retry would hit error.appAlreadyExists.
    let fileCount: number;
    try {
      await mkdir(appDir, {recursive: true});
      await writeFile(join(appDir, metadata.fileName), metadata.contents);
      ({fileCount} = await unpackComputeBundle(bundle, appDir));
    } catch (error) {
      await rm(appDir, {force: true, recursive: true});
      throw error;
    }

    this.log(messages.getMessage('info.extractedSource', [fileCount]));

    this.logSuccess(messages.getMessage('info.done', [name, appDir]));

    return {name, path: appDir, files: fileCount};
  }
}
