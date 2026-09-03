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

import { basename } from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { validateName, pathExists } from '../../shared/computeApp.js';
import { packageComputeBundle } from '../../shared/computeBundle.js';
import { uploadComputeSource } from '../../shared/computeConnectApi.js';
import { deployComputeMetadata } from '../../shared/metadataDeploy.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.deploy');

export type ComputeDeployResult = {
  name: string;
  platformComputeId: string;
  buildId: string;
};

export default class Deploy extends SfCommand<ComputeDeployResult> {
  public static readonly state = 'beta';
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly requiresProject = true;

  public static readonly flags = {
    'target-org': Flags.requiredOrg({ char: 'o' }),
  };

  public async run(): Promise<ComputeDeployResult> {
    const { flags } = await this.parse(Deploy);

    // No --name flag -- run this command from inside the compute app's own directory. The
    // directory's name doubles as the app's DeveloperName and the <name>.compute-meta.xml filename.
    const appDir = process.cwd();
    const name = basename(appDir);

    // Check this looks like an app directory before validating the name -- otherwise
    // running from the wrong place (e.g. the project root) surfaces a confusing "name
    // isn't valid" error instead of guidance to cd into the app's own directory.
    if (!(await pathExists(`${appDir}/${name}.compute-meta.xml`))) {
      throw messages.createError('error.notAppDir', [name]);
    }
    validateName(name);
    if (!(await pathExists(`${appDir}/Procfile`))) {
      throw messages.createError('error.noProcfile', [appDir]);
    }
    if (!(await pathExists(`${appDir}/api-spec.yaml`))) {
      throw messages.createError('error.noApiSpec', [appDir]);
    }

    const connection = flags['target-org'].getConnection();

    this.log(messages.getMessage('info.preparing', [name]));

    // requiresProject = true guarantees the framework has already resolved and assigned
    // this.project before run() is called.
    const projectRoot = this.project!.getPath();
    const { buffer, fileCount } = await packageComputeBundle(appDir, name, projectRoot);
    this.log(messages.getMessage('info.packaging', [fileCount, `${Math.round(buffer.length / 1024)}kb`]));

    // Source upload only inserts a pending PlatformComputeAppBuild row -- it does not
    // start a build. The metadata deploy below is what actually triggers it.
    const upload = await uploadComputeSource(connection, { name, bundle: buffer });
    this.log(messages.getMessage('info.uploading'));

    this.log(
      messages.getMessage('info.deployingMetadata', [
        connection.getUsername() ?? flags['target-org'].getUsername() ?? '<org>',
      ])
    );
    await deployComputeMetadata(connection, appDir, name);
    this.log(messages.getMessage('info.deployedMetaFile', [`${name}.compute-meta.xml`]));

    this.logSuccess(messages.getMessage('info.buildEnqueued'));

    return { name, platformComputeId: upload.platformComputeId, buildId: upload.buildId };
  }
}
