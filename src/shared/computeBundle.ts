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
import {Messages} from '@salesforce/core';
import ignore, {type Ignore} from 'ignore';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import {buffer as streamToBuffer} from 'node:stream/consumers';
import {createGzip, gunzipSync} from 'node:zlib';
import tarStream from 'tar-stream';

import {pathExists} from './computeApp.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// Gated by DEBUG=sf:compute:bundle (or DEBUG=*) -- see @oclif/core's Command#debug, which this
// mirrors for code that isn't a command instance.
const {debug} = getLogger('sf:compute:bundle');

export type PackagedBundle = {
  buffer: Buffer;
  fileCount: number;
};

// Bundle shape per the PlatformComputeAppBuild.SourceBlob design (deployment-bundle.tar.gz
// containing api-spec.yaml plus a nested source.tar.gz) -- see
// deployment/specs/PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "Nested Tarball Structure".
export async function packageComputeBundle(appDir: string, name: string, projectRoot: string): Promise<PackagedBundle> {
  const metaFileName = `${name}.computeApp-meta.xml`;
  // api-spec.yaml and project.toml also go into the outer bundle/get read by the Fir builder
  // respectively, but both are included here too: api-spec.yaml so the AppLink Service Mesh
  // Proxy has it at runtime, project.toml so CNB picks up its declared buildpacks (notably
  // heroku/heroku-applink-service-mesh, which nothing else installs).
  const excluded = new Set(['.forceignore', metaFileName]);
  // Build-critical, so a broad user .forceignore pattern (*.yaml, project.toml, ...) must not be
  // able to silently strip them and recreate the failure described above.
  const neverForceIgnored = new Set(['api-spec.yaml', 'project.toml']);
  const isForceIgnored = await loadForceIgnore(appDir, projectRoot);

  const allFiles = await listFilesRecursive(appDir);
  const sourceRelativePaths = allFiles.filter(
    f => !excluded.has(f) && (neverForceIgnored.has(f) || !isForceIgnored(f)),
  );
  debug(
    'packaging %s: %d of %d files after exclusions/.forceignore',
    appDir,
    sourceRelativePaths.length,
    allFiles.length,
  );

  const sourceEntries = await Promise.all(
    sourceRelativePaths.map(async relativePath => ({
      name: relativePath,
      data: await readFile(join(appDir, relativePath)),
    })),
  );
  const sourceTarGz = await tarGzip(sourceEntries);
  const apiSpec = await readFile(join(appDir, 'api-spec.yaml'));

  const buffer = await tarGzip([
    {name: 'api-spec.yaml', data: apiSpec},
    {name: 'source.tar.gz', data: sourceTarGz},
  ]);
  // api-spec.yaml appears in both the outer bundle and source.tar.gz but is one file on disk, so
  // the source entries (which always include it) are the distinct-file count.
  debug('packaged %s into %d bytes (%d files)', appDir, buffer.length, sourceEntries.length);

  return {buffer, fileCount: sourceEntries.length};
}

export type UnpackedBundle = {
  fileCount: number;
};

// One file from a downloaded bundle: where it goes (already confined to appDir) and its bytes.
export type BundleFile = {
  data: Buffer;
  filePath: string;
};

// Reads and checks the downloaded source.tar.gz without touching disk, so every archive or path
// problem (bad gzip/tar, empty or nested bundle, unsafe or duplicate entry paths) surfaces before
// the caller creates anything. The download endpoint returns that inner tarball directly
// (api-spec.yaml included), unlike the nested bundle packageComputeBundle uploads -- the
// asymmetry is deliberate: the appserver inspects the upload's top-level files without untarring
// the source. Used by sf compute source retrieve, the only caller that needs to go this direction.
export async function decodeComputeBundle(buffer: Buffer, appDir: string): Promise<BundleFile[]> {
  const sourceEntries = await untarGzip(buffer);
  // Release ordering alone doesn't protect against an org still returning the old nested bundle
  // (api-spec.yaml + source.tar.gz), which would otherwise "succeed" with an unextracted blob.
  if (Object.keys(sourceEntries).length === 0) {
    throw messages.createError('error.sourceBundleMalformed', ['archive contains no files']);
  }

  if ('source.tar.gz' in sourceEntries) {
    throw messages.createError('error.sourceBundleMalformed', [
      'unexpected nested source.tar.gz (the org returned the older nested bundle shape)',
    ]);
  }

  const resolvedAppDir = resolve(appDir);
  // Keyed by resolved path so entries that name the same file ("a" and "./a") collapse to one
  // write (the later entry wins, as in tar) instead of racing each other.
  const filesByPath = new Map<string, Buffer>();
  for (const [relativePath, data] of Object.entries(sourceEntries)) {
    const filePath = resolve(appDir, relativePath);
    // A tar-slip guard: a malicious (or corrupted) entry name like "../../etc/foo" must not be
    // allowed to write outside appDir, and a file entry can't be appDir itself. The bundle comes
    // from the org's most recently deployed source, which this plugin doesn't otherwise validate
    // the shape of.
    if (!filePath.startsWith(resolvedAppDir + sep)) {
      throw messages.createError('error.sourceBundleMalformed', [`unsafe entry path "${relativePath}"`]);
    }

    filesByPath.set(filePath, data);
  }

  return [...filesByPath].map(([filePath, data]) => ({data, filePath}));
}

// Writes decoded files to disk. Waits for every write to settle before failing, so a caller that
// cleans up after an error never races writes that are still in flight (which could recreate
// directories it just removed, or make its rm fail with ENOTEMPTY).
export async function writeBundleFiles(files: readonly BundleFile[]): Promise<void> {
  const results = await Promise.allSettled(
    files.map(async ({data, filePath}) => {
      await mkdir(dirname(filePath), {recursive: true});
      await writeFile(filePath, data);
    }),
  );

  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    throw failed.reason as Error;
  }
}

// Decode + write in one call. Kept as a convenience for tests; the retrieve command calls
// decodeComputeBundle and writeBundleFiles separately so it can create the app directory
// between the two.
export async function unpackComputeBundle(buffer: Buffer, appDir: string): Promise<UnpackedBundle> {
  const files = await decodeComputeBundle(buffer, appDir);
  await writeBundleFiles(files);
  return {fileCount: files.length};
}

// Inverse of tarGzip below -- decompress and read every file entry into memory, keyed by name.
// Directory entries are skipped (writing a file mkdirs its parents), and anything that isn't a
// plain file or directory (symlinks, hardlinks, devices) is rejected rather than silently
// written as an empty file. Wraps decompression/parse failures as error.sourceBundleMalformed
// rather than letting a raw zlib/tar-stream error (e.g. "incorrect header check") reach the
// user -- a truncated download or an HTTP error page returned with a 200 status both land here.
async function untarGzip(buffer: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolveEntries, reject) => {
    let decompressed: Buffer;
    try {
      decompressed = gunzipSync(buffer);
    } catch {
      reject(messages.createError('error.sourceBundleMalformed', ['not a valid gzip archive']));
      return;
    }

    const entries: Record<string, Buffer> = {};
    const extract = tarStream.extract();
    extract.on('entry', (header, stream, next) => {
      const isFile = header.type === 'file' || header.type === 'contiguous-file';
      if (!isFile && header.type !== 'directory') {
        // Stop reading the rest of the archive; the answer is already decided.
        extract.destroy();
        reject(
          messages.createError('error.sourceBundleMalformed', [
            `unsupported entry type "${header.type}" for "${header.name}"`,
          ]),
        );
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: unknown) => {
        chunks.push(chunk as Buffer);
      });
      stream.on('end', () => {
        if (isFile) {
          entries[header.name] = Buffer.concat(chunks);
        }

        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    extract.on('finish', () => {
      resolveEntries(entries);
    });
    extract.on('error', () => {
      reject(messages.createError('error.sourceBundleMalformed', ['not a valid tar archive']));
    });
    extract.end(decompressed);
  });
}

async function tarGzip(entries: ReadonlyArray<{data: Buffer; name: string}>): Promise<Buffer> {
  const pack = tarStream.pack();

  // Pipe (i.e. attach a consumer) BEFORE writing any entries. pack is a streamx Readable with a
  // 16KB highWaterMark; each pack.entry() write below only resolves its callback once
  // backpressure clears. With no consumer attached, once buffered-but-unread bytes cross 16KB,
  // push() returns false and the callback is deferred to the next _read() -- which never comes,
  // since nothing is piping yet. That deadlocked every real app whose combined source exceeded
  // ~16KB (small unit-test fixtures never hit the threshold, which is why this went unnoticed).
  const gzippedBufferPromise = streamToBuffer(pack.pipe(createGzip()));
  debug(
    'tarGzip: %d entries, %d total bytes',
    entries.length,
    entries.reduce((sum, e) => sum + e.data.length, 0),
  );

  // Entries share one pack stream and must be written one at a time, in order, so build a
  // single sequential promise chain (each entry waits on the previous) and await it once --
  // avoids both an await-in-loop and a reduce used purely for its sequencing side effect.
  let previous = Promise.resolve();
  for (const {name, data} of entries) {
    previous = previous.then(
      async () =>
        new Promise<void>((resolveEntry, reject) => {
          pack.entry({name, size: data.length}, data, err => {
            if (err) {
              reject(err);
            } else {
              resolveEntry();
            }
          });
        }),
    );
  }

  await previous;
  pack.finalize();
  return gzippedBufferPromise;
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
  const entries = await readdir(dir, {withFileTypes: true});
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
    }),
  );
  return nested.flat();
}
