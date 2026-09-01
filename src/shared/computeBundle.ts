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

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import tarStream from 'tar-stream';
import ignore, { type Ignore } from 'ignore';
import { pathExists } from './computeApp.js';

export type PackagedBundle = {
  buffer: Buffer;
  fileCount: number;
};

// Bundle shape per the PlatformComputeAppBuild.SourceBlob design (deployment-bundle.tar.gz
// containing api-spec.yaml plus a nested source.tar.gz) -- see
// deployment/specs/PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "Nested Tarball Structure".
export async function packageComputeBundle(appDir: string, name: string, projectRoot: string): Promise<PackagedBundle> {
  const metaFileName = `${name}.compute-meta.xml`;
  const excluded = new Set(['api-spec.yaml', metaFileName, 'project.toml', '.forceignore']);
  const isForceIgnored = await loadForceIgnore(appDir, projectRoot);

  const allFiles = await listFilesRecursive(appDir);
  const sourceRelativePaths = allFiles.filter((f) => !excluded.has(f) && !isForceIgnored(f));

  const sourceEntries = await Promise.all(
    sourceRelativePaths.map(async (relativePath) => ({
      name: relativePath,
      data: await readFile(join(appDir, relativePath)),
    }))
  );
  const sourceTarGz = await tarGzip(sourceEntries);
  const apiSpec = await readFile(join(appDir, 'api-spec.yaml'));

  const buffer = await tarGzip([
    { name: 'api-spec.yaml', data: apiSpec },
    { name: 'source.tar.gz', data: sourceTarGz },
  ]);

  return { buffer, fileCount: sourceEntries.length + 1 };
}

async function tarGzip(entries: ReadonlyArray<{ name: string; data: Buffer }>): Promise<Buffer> {
  const pack = tarStream.pack();
  // Entries share one pack stream and must be written one at a time, in order.
  await entries.reduce(
    (previous, { name, data }) =>
      previous.then(
        async () =>
          new Promise<void>((resolve, reject) => {
            pack.entry({ name, size: data.length }, data, (err) => (err ? reject(err) : resolve()));
          })
      ),
    Promise.resolve()
  );
  pack.finalize();
  return streamToBuffer(pack.pipe(createGzip()));
}

// A leading "/" in a .forceignore pattern anchors it to the directory that file lives in, so
// the project root's file and the app dir's file can't share one Ignore instance tested against
// app-relative paths -- a root-anchored "/src/**" would wrongly match the app's own src/ dir.
// Keep each file's Ignore in its own coordinate space: the app-dir filter tests app-relative
// paths directly, the project-root filter tests paths relative to the project root.
async function loadForceIgnore(appDir: string, projectRoot: string): Promise<(appRelativePath: string) => boolean> {
  const [appFilter, rootFilter] = await Promise.all([readForceIgnoreFile(appDir), readForceIgnoreFile(projectRoot)]);
  const appDirFromRoot = relative(projectRoot, appDir).split(sep).join('/');

  return (appRelativePath: string): boolean => {
    if (appFilter?.ignores(appRelativePath)) {
      return true;
    }
    if (rootFilter) {
      const rootRelativePath = appDirFromRoot ? `${appDirFromRoot}/${appRelativePath}` : appRelativePath;
      if (rootFilter.ignores(rootRelativePath)) {
        return true;
      }
    }
    return false;
  };
}

async function readForceIgnoreFile(dir: string): Promise<Ignore | undefined> {
  const forceIgnorePath = join(dir, '.forceignore');
  if (!(await pathExists(forceIgnorePath))) {
    return undefined;
  }
  return ignore().add(await readFile(forceIgnorePath, 'utf8'));
}

async function listFilesRecursive(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(full, base);
      }
      if (entry.isFile()) {
        return [relative(base, full).split(sep).join('/')];
      }
      return [];
    })
  );
  return nested.flat();
}
