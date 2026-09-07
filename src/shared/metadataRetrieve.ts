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

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Connection } from '@salesforce/core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Inverse of deployComputeMetadata in metadataDeploy.ts. Note the asymmetry with that function's
// deployResult.complete(true): RetrieveResultLocator#complete() takes no argument (unlike
// DeployResultLocator#complete(includeDetails?)), per @jsforce/jsforce-node's metadata.d.ts.
export async function retrieveComputeMetadata(connection: Connection, appDir: string, name: string): Promise<void> {
  const version = connection.getApiVersion();
  const retrieveResult = connection.metadata.retrieve({
    apiVersion: Number(version),
    singlePackage: true,
    unpackaged: {
      types: [{ members: [name], name: 'PlatformComputeApp' }],
      version,
      // Package requires objectPermissions -- retrieve doesn't use it, but the type isn't
      // Partial<Package> the way the outer RetrieveRequest is Partial<RetrieveRequest>.
      objectPermissions: [],
    },
  });
  const result = await retrieveResult.complete();

  if (!result.success) {
    throw messages.createError('error.metadataRetrieveFailed', [name, result.errorMessage ?? 'Unknown error.']);
  }

  const zip = await JSZip.loadAsync(result.zipFile, { base64: true });
  const metaFileName = `${name}.compute-meta.xml`;
  const metaEntry = zip.file(`compute/${name}/${metaFileName}`);
  if (!metaEntry) {
    throw messages.createError('error.metadataRetrieveFailed', [
      name,
      `the retrieved metadata is missing compute/${name}/${metaFileName}`,
    ]);
  }

  await writeFile(join(appDir, metaFileName), await metaEntry.async('nodebuffer'));
}
