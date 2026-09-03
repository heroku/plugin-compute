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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect } from 'chai';
import tarStream from 'tar-stream';
import { packageComputeBundle } from '../../src/shared/computeBundle.js';

async function extractTarGz(buffer: Buffer): Promise<Record<string, Buffer>> {
  const entries: Record<string, Buffer> = {};
  const extract = tarStream.extract();

  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
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

describe('computeBundle.packageComputeBundle', () => {
  let projectRoot: string;
  let appDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'plugin-compute-bundle-'));
    appDir = join(projectRoot, 'force-app/main/default/compute/CreditRatingScorer');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, 'api-spec.yaml'), 'openapi: 3.0.0\n');
    await writeFile(join(appDir, 'Procfile'), 'web: node src/app.js\n');
    await writeFile(join(appDir, 'CreditRatingScorer.compute-meta.xml'), '<PlatformComputeApp/>\n');
    await writeFile(join(appDir, 'project.toml'), '[_]\nschema-version = "0.2"\n');
    await mkdir(join(appDir, 'src'), { recursive: true });
    await writeFile(join(appDir, 'src', 'app.js'), 'console.log("hi");\n');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('produces a bundle with exactly api-spec.yaml and a nested source.tar.gz', async () => {
    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const outer = await extractTarGz(buffer);
    expect(Object.keys(outer).sort()).to.deep.equal(['api-spec.yaml', 'source.tar.gz']);
    expect(outer['api-spec.yaml'].toString('utf8')).to.equal('openapi: 3.0.0\n');
  });

  it('excludes api-spec.yaml, the compute-meta.xml, and project.toml from source.tar.gz', async () => {
    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const outer = await extractTarGz(buffer);
    const source = await extractTarGz(outer['source.tar.gz']);

    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
    expect(source['src/app.js'].toString('utf8')).to.equal('console.log("hi");\n');
  });

  it('reports the source file count excluding api-spec.yaml, meta xml, and project.toml', async () => {
    const { fileCount } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    expect(fileCount).to.equal(3); // Procfile, src/app.js, plus the api-spec.yaml entry in the outer bundle
  });

  it('excludes files matching the app-level .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, '.forceignore'), '*.log\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('excludes files matching the project-root .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'secret.pem'), 'private key\n');
    await writeFile(join(projectRoot, '.forceignore'), '*.pem\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('does not let a project-root-anchored pattern match an unrelated app-relative path of the same name', async () => {
    // A pattern anchored with a leading "/" in the project root's .forceignore scopes to a
    // top-level dir at the project root -- it must not also match the app's own src/ dir, which
    // happens to share the name but lives at a different path.
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'unrelated.js'), 'unrelated\n');
    await writeFile(join(projectRoot, '.forceignore'), '/src/**\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('honors negation patterns within a single .forceignore', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, 'src', 'keep.log'), 'keep me\n');
    await writeFile(join(appDir, '.forceignore'), '*.log\n!keep.log\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js', 'src/keep.log']);
  });

  it('excludes a path ignored by either file, even if the other file does not mention it', async () => {
    await writeFile(join(appDir, 'src', 'app.log'), 'debug output\n');
    await writeFile(join(appDir, '.forceignore'), '!app.log\n');
    await writeFile(join(projectRoot, '.forceignore'), '*.log\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['Procfile', 'src/app.js']);
  });

  it('excludes Procfile if a .forceignore pattern happens to match it', async () => {
    // packageComputeBundle only guards api-spec.yaml/meta-xml/project.toml/.forceignore itself
    // from user-authored ignore rules -- Procfile is not special-cased, so a broad pattern here
    // silently produces an unbuildable bundle. Locking in current behavior; deploy.ts is
    // responsible for surfacing this earlier if it becomes a problem in practice.
    await writeFile(join(appDir, '.forceignore'), 'Procfile\n');

    const { buffer } = await packageComputeBundle(appDir, 'CreditRatingScorer', projectRoot);

    const source = await extractTarGz((await extractTarGz(buffer))['source.tar.gz']);
    expect(Object.keys(source).sort()).to.deep.equal(['src/app.js']);
  });
});
