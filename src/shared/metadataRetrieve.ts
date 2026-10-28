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

import {getLogger} from '@oclif/core';
import {type Connection, Messages} from '@salesforce/core';
import JSZip from 'jszip';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {resolveComputeApiVersion} from './metadataApiVersion.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// Gated by DEBUG=sf:compute:metadataRetrieve (or DEBUG=*).
const {debug} = getLogger('sf:compute:metadataRetrieve');

// Inverse of deployComputeMetadata in metadataDeploy.ts, but NOT built on SDR's
// ComponentSet/MetadataApiRetrieve the way that function is built on MetadataApiDeploy --
// ComputeApp has no entry in SDR's metadata registry, and ComponentSet.getObject()
// (called internally when building a retrieve request) requires resolving every member's type
// against that registry, so it throws for this type today. This uses jsforce's lower-level
// retrieve API directly instead. Note the asymmetry with deployComputeMetadata's
// deployResult.complete(true): RetrieveResultLocator#complete() takes no argument (unlike
// DeployResultLocator#complete(includeDetails?)), per @jsforce/jsforce-node's metadata.d.ts.
export async function retrieveComputeMetadata(connection: Connection, appDir: string, name: string): Promise<void> {
  const version = resolveComputeApiVersion(connection);
  const retrieveResult = connection.metadata.retrieve({
    apiVersion: Number(version),
    singlePackage: true,
    unpackaged: {
      types: [{members: [name], name: 'ComputeApp'}],
      version,
      // Package requires objectPermissions -- retrieve doesn't use it, but the type isn't
      // Partial<Package> the way the outer RetrieveRequest is Partial<RetrieveRequest>.
      objectPermissions: [],
    },
  });
  debug('started metadata retrieve for %s from %s', name, connection.getUsername() ?? '<org>');
  const result = await retrieveResult.complete();
  debug('metadata retrieve complete for %s: success=%s', name, result.success);

  if (!result.success) {
    throw messages.createError('error.metadataRetrieveFailed', [name, result.errorMessage ?? 'Unknown error.']);
  }

  const zip = await JSZip.loadAsync(result.zipFile, {base64: true});
  // Wire directoryName/suffix -- see the matching comment in metadataDeploy.ts. Our own on-disk
  // source-format filename (<name>.computeApp-meta.xml) is independent of the wire filename.
  const wireFileName = `${name}.computeApp`;
  const metaFileName = `${name}.computeApp-meta.xml`;
  const metaEntry = zip.file(`computeApps/${wireFileName}`);
  if (!metaEntry) {
    // An unknown type doesn't fail the retrieve -- it only adds a warning to result.messages.
    const problems = [result.messages ?? []].flat().map(m => m.problem);
    const problemDetail = problems.length > 0 ? ` (${problems.join('; ')})` : '';
    throw messages.createError('error.metadataRetrieveFailed', [
      name,
      `the retrieved metadata is missing computeApps/${wireFileName}${problemDetail}`,
    ]);
  }

  await mkdir(appDir, {recursive: true});
  await writeFile(join(appDir, metaFileName), await metaEntry.async('nodebuffer'));
}
