import {TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, sep} from 'node:path';

import type {FetchTemplateSource, Language} from '../../../src/shared/computeGenerateSource.js';

import Generate from '../../../src/commands/compute/generate.js';

// Keeps this suite offline: production Generate.fetchTemplateSource does a live HTTPS fetch of
// the pinned reference-app commit, so tests swap in an in-memory fixture standing in for the
// whole fetched tarball. buildStarterFiles writes these paths out verbatim except for the
// denylisted ones (governance files, example routers/tests), so the fixture includes both
// kinds, plus files like package-lock.json and devDependencies that a real fetch carries through.
// Mimics the reference apps' local-invoke scripts: defaults/examples name the example endpoints.
/* eslint-disable no-template-curly-in-string -- literal shell parameter expansion from the upstream script */
const INVOKE_FIXTURE = [
  'API_PATH="${6:-/accounts}"  # python: /api/accounts/',
  '# POST /unitofwork',
  '',
].join('\n');

/* eslint-enable no-template-curly-in-string */

const FIXTURE_SOURCE: Record<Language, Record<string, string>> = {
  node: {
    Procfile: 'web: APP_PORT=3000 heroku-applink-service-mesh npm start\n',
    'src/app.js': 'export default async function (fastify, opts) {}\n',
    'src/plugins/heroku-applink.js': "import fp from 'fastify-plugin';\nexport default fp(async () => {});\n",
    'package.json': JSON.stringify({
      name: 'applink-getting-started-nodejs',
      type: 'module',
      main: 'src/app.js',
      scripts: {start: 'fastify start src/app.js', dev: 'fastify start -w src/app.js', lint: 'eslint src'},
      license: 'Apache-2.0',
      engines: {node: '>=20.0.0 <24.0.0'},
      dependencies: {fastify: '^5.4.0', 'fastify-cli': '^7.4.0'},
      devDependencies: {eslint: '^9.14.0'},
    }),
    'package-lock.json': JSON.stringify({name: 'applink-getting-started-nodejs', lockfileVersion: 3}),
    'bin/invoke.sh': INVOKE_FIXTURE,
    CODEOWNERS: '* @heroku-reference-apps/maintainers\n',
    'LICENSE.txt': 'Apache License\n',
    'app.json': '{"name":"applink-getting-started-nodejs"}\n',
    'test/routes/accounts.test.js': "import { test } from 'tap';\n",
  },
  python: {
    Procfile: 'web: APP_PORT=3000 heroku-applink-service-mesh uvicorn app.main:app\n',
    'requirements.txt': 'fastapi>=0.109.2\nuvicorn>=0.27.1\nheroku-applink>=1.0.0\nPyYAML>=6.0.1\npytest>=8.2.0\n',
    'bin/invoke.py': INVOKE_FIXTURE,
    'tests/test_main.py': 'def test_get_health(client):\n    pass\n',
    'tests/routers/test_accounts.py': 'def test_accounts(client):\n    pass\n',
    'app/routers/accounts.py': 'router = None\n',
    'SECURITY.md': 'security\n',
  },
};

// Forward-slash path of a generated file relative to its app dir, so assertions hold on Windows.
function appRelative(filePath: string, appName: string): string {
  const appDir = join('platformComputeApps', appName) + sep;
  return filePath.slice(filePath.indexOf(appDir) + appDir.length).split(sep).join('/');
}

const stubFetchTemplateSource: FetchTemplateSource = async language => {
  const entries: Record<string, Buffer> = {};
  for (const [path, contents] of Object.entries(FIXTURE_SOURCE[language])) {
    entries[path] = Buffer.from(contents, 'utf8');
  }

  return entries;
};

describe('compute generate', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let projectDir: string;
  let originalCwd: string;
  let originalFetchTemplateSource: FetchTemplateSource;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    originalCwd = process.cwd();
    projectDir = await mkdtemp(join(tmpdir(), 'plugin-compute-'));
    await writeFile(
      join(projectDir, 'sfdx-project.json'),
      JSON.stringify({packageDirectories: [{default: true, path: 'force-app'}]}),
    );
    process.chdir(projectDir);
    originalFetchTemplateSource = Generate.fetchTemplateSource;
    Generate.fetchTemplateSource = stubFetchTemplateSource;
  });

  afterEach(async () => {
    Generate.fetchTemplateSource = originalFetchTemplateSource;
    process.chdir(originalCwd);
    await rm(projectDir, {force: true, recursive: true});
    $$.restore();
  });

  it('scaffolds a node compute app by default', async () => {
    const result = await Generate.run(['--name', 'CreditRatingScorer']);

    expect(result.name).to.equal('CreditRatingScorer');
    expect(result.language).to.equal('node');
    expect(result.files).to.have.length(12);
    expect(result.files.some(f => f.endsWith(join('src', 'app.js')))).to.be.true;
    expect(result.files.some(f => f.endsWith(join('src', 'plugins', 'heroku-applink.js')))).to.be.true;
    expect(result.files.some(f => f.endsWith('package-lock.json'))).to.be.true;
    expect(result.files.some(f => f.endsWith(join('test', 'routes', 'healthcheck.test.js')))).to.be.true;

    const metaXml = await readFile(
      join(
        projectDir,
        'force-app/main/default/platformComputeApps/CreditRatingScorer/CreditRatingScorer.compute-meta.xml',
      ),
      'utf8',
    );
    expect(metaXml).to.include('<masterLabel>CreditRatingScorer</masterLabel>');
    expect(metaXml).to.include('<description>Compute app generated by sf compute generate.</description>');

    const projectToml = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer/project.toml'),
      'utf8',
    );
    expect(projectToml).to.include('id = "heroku/nodejs"');
    expect(projectToml).to.include('id = "heroku/heroku-applink"');
    expect(projectToml).to.include('id = "heroku/procfile"');

    const packageJson = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer/package.json'),
      'utf8',
    );
    expect(packageJson).to.include('"fastify-cli"');
    expect(packageJson).to.include('devDependencies');

    const packageLockJson = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/CreditRatingScorer/package-lock.json'),
      'utf8',
    );
    expect(packageLockJson).to.include('"lockfileVersion"');

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).to.include('Generating compute app CreditRatingScorer');
  });

  it('scaffolds a python compute app', async () => {
    const result = await Generate.run(['--name', 'ReceiptOcr', '--language', 'python']);

    expect(result.language).to.equal('python');
    expect(result.files.some(f => f.endsWith('requirements.txt'))).to.be.true;
    expect(result.files.some(f => f.endsWith(join('app', 'main.py')))).to.be.true;

    const mainPy = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/ReceiptOcr/app/main.py'),
      'utf8',
    );
    expect(mainPy).to.include('title="ReceiptOcr"');

    const requirementsTxt = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/ReceiptOcr/requirements.txt'),
      'utf8',
    );
    expect(requirementsTxt).to.include('fastapi');
    expect(requirementsTxt).to.include('pytest');

    const projectToml = await readFile(
      join(projectDir, 'force-app/main/default/platformComputeApps/ReceiptOcr/project.toml'),
      'utf8',
    );
    expect(projectToml).to.include('id = "heroku/python"');
    expect(projectToml).to.include('id = "heroku/heroku-applink"');
    expect(projectToml).to.include('id = "heroku/procfile"');
  });

  it('scaffolds into a custom --output-dir', async () => {
    const result = await Generate.run(['--name', 'CustomDir', '--output-dir', 'custom/compute']);

    expect(result.path).to.equal(join('custom/compute', 'CustomDir'));
  });

  it('fails when the app already exists', async () => {
    await Generate.run(['--name', 'Dup']);

    try {
      await Generate.run(['--name', 'Dup']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('already exists');
    }
  });

  it('rejects a name that would traverse outside the output directory', async () => {
    try {
      await Generate.run(['--name', '../evil']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include("isn't valid");
    }
  });

  it('surfaces a clear error when the template source fetch fails', async () => {
    Generate.fetchTemplateSource = async () => {
      throw new Error('boom');
    };

    try {
      await Generate.run(['--name', 'FetchFails']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('boom');
    }
  });

  it('surfaces a clear error when the fetched source is missing an expected file', async () => {
    Generate.fetchTemplateSource = async () => ({});

    try {
      await Generate.run(['--name', 'MissingFile']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('Procfile');
    }
  });

  it('omits upstream governance files and example tests from the node app', async () => {
    const result = await Generate.run(['--name', 'CleanNode']);
    const relative = result.files.map(f => appRelative(f, 'CleanNode'));

    for (const denied of ['CODEOWNERS', 'LICENSE.txt', 'app.json', 'test/routes/accounts.test.js']) {
      expect(relative, denied).to.not.include(denied);
    }
  });

  it('omits upstream governance files, example routers, and example router tests from the python app', async () => {
    const result = await Generate.run(['--name', 'CleanPython', '--language', 'python']);
    const relative = result.files.map(f => appRelative(f, 'CleanPython'));

    for (const denied of ['SECURITY.md', 'app/routers/accounts.py', 'tests/routers/test_accounts.py']) {
      expect(relative, denied).to.not.include(denied);
    }

    // The upstream tests that still pass against the skeleton are kept.
    expect(relative).to.include('tests/test_main.py');
  });

  it('retargets the invoke scripts away from endpoints the generated app does not have', async () => {
    await Generate.run(['--name', 'InvokeNode']);
    await Generate.run(['--name', 'InvokePython', '--language', 'python']);
    const base = join(projectDir, 'force-app/main/default/platformComputeApps');

    const nodeScript = await readFile(join(base, 'InvokeNode/bin/invoke.sh'), 'utf8');
    // eslint-disable-next-line no-template-curly-in-string
    expect(nodeScript).to.include('${6:-/healthcheck}');
    expect(nodeScript).to.include('POST /hello');
    expect(nodeScript).to.not.include('/accounts');
    expect(nodeScript).to.not.include('/unitofwork');

    const pythonScript = await readFile(join(base, 'InvokePython/bin/invoke.py'), 'utf8');
    expect(pythonScript).to.not.include('accounts');
    expect(pythonScript).to.include('/health');
  });

  it('fails at generate time when the fetched source lacks a file the app needs to run', async () => {
    Generate.fetchTemplateSource = async language => {
      const entries = await stubFetchTemplateSource(language);
      delete entries['package-lock.json'];
      return entries;
    };

    try {
      await Generate.run(['--name', 'NoLockfile']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.include('package-lock.json');
    }
  });
});
