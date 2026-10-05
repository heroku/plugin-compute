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
import {ensureArray} from '@salesforce/kit';
import {MetadataApiDeploy} from '@salesforce/source-deploy-retrieve';
import JSZip from 'jszip';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {resolveComputeApiVersion} from './metadataApiVersion.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// Gated by DEBUG=sf:compute:metadataDeploy (or DEBUG=*).
const {debug} = getLogger('sf:compute:metadataDeploy');

export type ComputeMetadataDeployResult = {
  id: string;
};

// Deploying <name>.compute-meta.xml is what actually triggers the build server-side (sets
// CurrentBuild + Status=DEPLOYING and kicks off the async worker) -- source upload alone does
// not. See deployment/specs/PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "POST /source Inserts a
// PlatformComputeAppBuild Row -- Does NOT Trigger Deploy". Call this AFTER uploadComputeSource.
//
// Built on SDR's MetadataApiDeploy -- the same class `sf project deploy start`/`report` use --
// so the returned job id is checkable with `sf project deploy report --job-id <id>` like any
// other metadata deploy, not just through this plugin's own commands.
export async function deployComputeMetadata(
  connection: Connection,
  appDir: string,
  name: string,
): Promise<ComputeMetadataDeployResult> {
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
      `    <version>${resolveComputeApiVersion(connection)}</version>`,
      '</Package>',
      '',
    ].join('\n'),
  );
  // PlatformComputeApp is a standard (non-bundle) metadata type -- flat
  // directoryName/<name>.<suffix>, not a per-component subdirectory like LWC/Aura bundles use.
  // Wire directoryName is "platformComputeApps" per org describeMetadata (expected to become
  // "compute" later); suffix is "compute" with metaFile: false, so there's no separate -meta.xml
  // file on the wire -- that's purely our own on-disk source-format convention.
  zip.file(`platformComputeApps/${name}.compute`, metaXml);

  const zipBuffer = await zip.generateAsync({type: 'nodebuffer'});

  // MetadataApiDeploy's getZipBuffer() only accepts a ComponentSet, an mdapiPath directory, or a
  // zipPath file -- there's no "hand it a Buffer directly" option, so the in-memory zip built
  // above has to make a round trip through a temp file.
  const tempDir = await mkdtemp(join(tmpdir(), 'sf-compute-deploy-'));
  const zipPath = join(tempDir, `${name}.zip`);
  try {
    await writeFile(zipPath, zipBuffer);

    const deploy = new MetadataApiDeploy({
      usernameOrConnection: connection,
      zipPath,
      apiOptions: {singlePackage: true},
    });

    const {id} = await deploy.start();
    debug('started metadata deploy %s for %s', id, name);

    // MetadataApiDeploy.pollStatus() sizes its own polling frequency from the zip it just
    // built (1s-10s depending on payload size) and defaults its timeout to 60 minutes -- both
    // more generous than the fixed 2s/10min this file used before adopting SDR.
    const result = await deploy.pollStatus();

    if (!result.response.success) {
      const failureDetail = ensureArray(result.response.details.componentFailures)
        .map(f => f.problem)
        .filter(Boolean)
        .join('; ');
      throw messages.createError('error.metadataDeployFailed', [name, failureDetail || 'Unknown error.']);
    }

    return {id};
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
}
