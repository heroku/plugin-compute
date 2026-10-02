import {expect} from 'chai';
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
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import tarStream from 'tar-stream';

import {packageComputeBundle, unpackComputeBundle} from '../../src/shared/computeBundle.js';

async function extractTarGz(buffer: Buffer): Promise<Record<string, Buffer>> {
  const entries: Record<string, Buffer> = {};
  const extract = tarStream.extract();

  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: unknown) => {
        chunks.push(chunk as Buffer);
      });
      stream.on('end', () => {
        entries[header.name] = Buffer.concat(chunks);
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    extract.end(gunzipSync(buffer));
  });

  return entries;
}

async function buildTarGz(entries: ReadonlyArray<{data: Buffer; name: string}>): Promise<Buffer> {
  const pack = tarStream.pack();
  // Sequential promise chain (entries written one at a time, in order), awaited once.
  let previous = Promise.resolve();
  for (const {data, name} of entries) {
    previous = previous.then(
      async () =>
        new Promise<void>((resolve, reject) => {
          pack.entry({name, size: data.length}, data, err => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }),
    );
  }

  await previous;
  pack.finalize();

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pack.on('data', (chunk: unknown) => {
      chunks.push(chunk as Buffer);
    });
    pack.on('end', () => {
      resolve(gzipSync(Buffer.concat(chunks)));
    });
    pack.on('error', reject);
  });
}

describe('computeBundle.packageComputeBundle', () => {
  let projectRoot: string;
  let appDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'plugin-compute-bundle-'));
    appDir = join(projectRoot, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
    await mkdir(appDir, {recursive: true});
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    await writeFile(join(appDir, 'project.toml'), '[_]\nschema-version = "0.2"\n');
    await mkdir(join(appDir, 'src'), {recursive: true});
    await writeFile(join(appDir, 'src', 'app.js'), 'console.log("hi");\n');
  });

  afterEach(async () => {
    await rm(projectRoot, {force: true, recursive: true});
  });

  it('produces a bundle with exactly api-spec.yaml and a nested source.tar.gz', async () => {
    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const outer = await extractTarGz(buffer);
    expect(Object.keys(outer).toSorted()).to.deep.equal(['api-spec.yaml', 'source.tar.gz']);
    expect(outer['api-spec.yaml'].toString('utf8')).to.equal('openapi: 3.0.0\n');
  });

  it('excludes api-spec.yaml, the compute-meta.xml, and project.toml from source.tar.gz', async () => {
    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const outer = await extractTarGz(buffer);
    const source = await extractTarGz(outer['source.tar.gz']);

    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js']);
    expect(source['src/app.js'].toString('utf8')).to.equal('console.log("hi");\n');
  });

  it('reports the source file count excluding api-spec.yaml, meta xml, and project.toml', async () => {
    const {fileCount} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    expect(fileCount).to.equal(3); // Procfile, src/app.js, plus the api-spec.yaml entry in the outer bundle
  });

  it('excludes files matching the app-level .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, '.forceignore'), '*.log\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('excludes files matching the project-root .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'secret.pem'), 'private key\n');
    await writeFile(join(projectRoot, '.forceignore'), '*.pem\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('does not let a project-root-anchored pattern match an unrelated app-relative path of the same name', async () => {
    // A pattern anchored with a leading "/" in the project root's .forceignore scopes to a
    // top-level dir at the project root -- it must not also match the app's own src/ dir, which
    // happens to share the name but lives at a different path.
    await mkdir(join(projectRoot, 'src'), {recursive: true});
    await writeFile(join(projectRoot, 'src', 'unrelated.js'), 'unrelated\n');
    await writeFile(join(projectRoot, '.forceignore'), '/src/**\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('honors negation patterns within a single .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, 'src', 'keep.log'), 'keep me\n');
    await writeFile(join(appDir, '.forceignore'), '*.log\n!keep.log\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js', 'src/keep.log']);
  });

  it('excludes a path ignored by either file, even if the other file does not mention it', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, '.forceignore'), '!app.log\n');
    await writeFile(join(projectRoot, '.forceignore'), '*.log\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('excludes Procfile if a .forceignore pattern happens to match it', async () => {
    // packageComputeBundle only guards api-spec.yaml/meta-xml/project.toml/.forceignore itself
    // from user-authored ignore rules -- Procfile is not special-cased, so a broad pattern here
    // silently produces an unbuildable bundle. Locking in current behavior; deploy.ts is
    // responsible for surfacing this earlier if it becomes a problem in practice.
    await writeFile(join(appDir, '.forceignore'), 'Procfile\n');

    const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).toSorted()).to.deep.equal(['src/app.js']);
  });
});

describe('computeBundle.unpackComputeBundle', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'plugin-compute-unbundle-'));
  });

  afterEach(async () => {
    await rm(outputDir, {force: true, recursive: true});
  });

  it('round-trips packageComputeBundle output into api-spec.yaml and the source files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'plugin-compute-bundle-src-'));
    try {
      const appDir = join(projectRoot, 'force-app/main/default/platformComputeApps/CreditRatingScorer');
      await mkdir(join(appDir, 'src'), {recursive: true});
      await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
      await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
      await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
      await writeFile(join(appDir, 'project.toml'), '[_]\nschema-version = "0.2"\n');
      await writeFile(join(appDir, 'src', 'app.js'), 'console.log("hi");\n');
      const {buffer} = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

      const {fileCount} = await unpackComputeBundle(buffer, outputDir);

      expect(fileCount).to.equal(3); // Procfile, src/app.js, plus api-spec.yaml
      expect(await readFile(join(outputDir, 'api-spec.yaml'), 'utf8')).to.equal('openapi: 3.0.0\n');
      expect(await readFile(join(outputDir, 'Procfile'), 'utf8')).to.equal('web: node src/app.js\n');
      expect(await readFile(join(outputDir, 'src', 'app.js'), 'utf8')).to.equal('console.log("hi");\n');
    } finally {
      await rm(projectRoot, {force: true, recursive: true});
    }
  });

  it('recreates nested directories for nested source paths', async () => {
    const sourceTarGz = await buildTarGz([{data: Buffer.from('module.exports = {};\n'), name: 'lib/nested/util.js'}]);
    const outer = await buildTarGz([
      {data: Buffer.from('openapi: 3.0.0\n'), name: 'api-spec.yaml'},
      {data: sourceTarGz, name: 'source.tar.gz'},
    ]);

    const {fileCount} = await unpackComputeBundle(outer, outputDir);

    expect(fileCount).to.equal(2); // lib/nested/util.js, plus api-spec.yaml
    expect(await readFile(join(outputDir, 'lib', 'nested', 'util.js'), 'utf8')).to.equal('module.exports = {};\n');
  });

  it('throws error.sourceBundleMalformed when the outer bundle is missing api-spec.yaml', async () => {
    const sourceTarGz = await buildTarGz([{data: Buffer.from('web: node src/app.js\n'), name: 'Procfile'}]);
    const outer = await buildTarGz([{data: sourceTarGz, name: 'source.tar.gz'}]);

    try {
      await unpackComputeBundle(outer, outputDir);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('api-spec.yaml');
    }
  });

  it('throws error.sourceBundleMalformed when the outer bundle is missing source.tar.gz', async () => {
    const outer = await buildTarGz([{data: Buffer.from('openapi: 3.0.0\n'), name: 'api-spec.yaml'}]);

    try {
      await unpackComputeBundle(outer, outputDir);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('source.tar.gz');
    }
  });

  it('rejects a source entry whose name would tar-slip outside appDir, without writing it', async () => {
    const sourceTarGz = await buildTarGz([{data: Buffer.from('pwned'), name: '../evil.txt'}]);
    const outer = await buildTarGz([
      {data: Buffer.from('openapi: 3.0.0\n'), name: 'api-spec.yaml'},
      {data: sourceTarGz, name: 'source.tar.gz'},
    ]);

    try {
      await unpackComputeBundle(outer, outputDir);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('unsafe entry path');
    }

    let isEscaped = true;
    try {
      await readFile(join(outputDir, '..', 'evil.txt'), 'utf8');
    } catch {
      isEscaped = false;
    }

    expect(isEscaped, 'evil.txt must not have been written outside outputDir').to.be.false;
  });

  it('throws error.sourceBundleMalformed instead of a raw zlib error when the download is not a valid gzip stream', async () => {
    try {
      await unpackComputeBundle(Buffer.from('not a gzip archive'), outputDir);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('not a valid gzip archive');
    }
  });

  it('throws error.sourceBundleMalformed instead of a raw tar-stream error when the outer archive is gzip but not a valid tar', async () => {
    const notATar = gzipSync(Buffer.from('just some gzipped bytes, not a tar archive'));

    try {
      await unpackComputeBundle(notATar, outputDir);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('not a valid tar archive');
    }
  });
});
