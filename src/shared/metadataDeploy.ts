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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Connection } from '@salesforce/core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Deploying <name>.compute-meta.xml is what actually triggers the build server-side (sets
// CurrentBuild + Status=DEPLOYING and kicks off the async worker) -- source upload alone does
// not. See deployment/specs/PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "POST /source Inserts a
// PlatformComputeAppBuild Row -- Does NOT Trigger Deploy". Call this AFTER uploadComputeSource.
export async function deployComputeMetadata(connection: Connection, appDir: string, name: string): Promise<void> {
  const metaXml = await readFile(join(appDir, `${name}.compute-meta.xml`), 'utf8');

  const zip = new JSZip();
  zip.file(
    'package.xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
      '    <types>',
      `        <members>${name}</members>`,
      '        <name>PlatformComputeApp</name>',
      '    </types>',
      `    <version>${connection.getApiVersion()}</version>`,
      '</Package>',
      '',
    ].join('\n')
  );
  // PlatformComputeApp's mdapi directoryName nests each app in its own subdirectory:
  // compute/<name>/<name>.compute-meta.xml.
  zip.file(`compute/${name}/${name}.compute-meta.xml`, metaXml);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  const deployResult = connection.metadata.deploy(zipBuffer, { singlePackage: true });
  const result = await deployResult.complete(true);

  if (!result.success) {
    const failureDetail = result.details.componentFailures
      .map((f: { problem?: string | null }) => f.problem)
      .join('; ');
    throw messages.createError('error.metadataDeployFailed', [name, failureDetail || 'Unknown error.']);
  }
}
