import {TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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
  const appDir = join('computeApps', appName) + sep;
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

  it('is deprecated in favor of sf template generate project', () => {
    expect(Generate.state).toBe('deprecated');
    expect(Generate.deprecationOptions?.to).toBe('template generate project');
    expect(Generate.deprecationOptions?.message).toBe(
      'This command will be available as sf template generate project --template compute in version 1.0.0 of plugin-compute.',
    );
  });

  it('emits the deprecation warning exactly once at runtime', async () => {
    await Generate.run(['--name', 'WarnOnce']);

    const deprecationWarnings = sfCommandStubs.warn
      .getCalls()
      .filter(call => (call.args as [string])[0].includes(Generate.deprecationOptions.message));
    expect(deprecationWarnings).toHaveLength(1);
  });

  it('scaffolds a node compute app by default', async () => {
    const result = await Generate.run(['--name', 'CreditRatingScorer']);

    expect(result.name).toBe('CreditRatingScorer');
    expect(result.language).toBe('node');
    expect(result.files).toHaveLength(12);
    expect(result.files.some(f => f.endsWith(join('src', 'app.js')))).toBe(true);
    expect(result.files.some(f => f.endsWith(join('src', 'plugins', 'heroku-applink.js')))).toBe(true);
    expect(result.files.some(f => f.endsWith('package-lock.json'))).toBe(true);
    expect(result.files.some(f => f.endsWith(join('test', 'routes', 'healthcheck.test.js')))).toBe(true);

    const metaXml = await readFile(
      join(
        projectDir,
        'force-app/main/default/computeApps/CreditRatingScorer/CreditRatingScorer.computeApp-meta.xml',
      ),
      'utf8',
    );
    expect(metaXml).toContain('<masterLabel>CreditRatingScorer</masterLabel>');
    expect(metaXml).toContain('<description>Compute app generated by sf compute generate.</description>');

    const projectToml = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer/project.toml'),
      'utf8',
    );
    expect(projectToml).toContain('id = "heroku/nodejs"');
    expect(projectToml).toContain('id = "heroku/heroku-applink"');
    expect(projectToml).toContain('id = "heroku/procfile"');

    const packageJson = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer/package.json'),
      'utf8',
    );
    expect(packageJson).toContain('"fastify-cli"');
    expect(packageJson).toContain('devDependencies');

    const packageLockJson = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer/package-lock.json'),
      'utf8',
    );
    expect(packageLockJson).toContain('"lockfileVersion"');

    const readme = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/CreditRatingScorer/README.md'),
      'utf8',
    );
    expect(readme).toContain('sf plugins install @salesforce/plugin-deploy-retrieve@compute');
    expect(readme).toContain('sf project deploy start --metadata ComputeApp:CreditRatingScorer --target-org <org>');

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap(c => c.args)
      .join('\n');
    expect(output).toContain('Generating compute app CreditRatingScorer');
  });

  it('scaffolds a python compute app', async () => {
    const result = await Generate.run(['--name', 'ReceiptOcr', '--language', 'python']);

    expect(result.language).toBe('python');
    expect(result.files.some(f => f.endsWith('requirements.txt'))).toBe(true);
    expect(result.files.some(f => f.endsWith(join('app', 'main.py')))).toBe(true);

    const mainPy = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/ReceiptOcr/app/main.py'),
      'utf8',
    );
    expect(mainPy).toContain('title="ReceiptOcr"');

    const requirementsTxt = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/ReceiptOcr/requirements.txt'),
      'utf8',
    );
    expect(requirementsTxt).toContain('fastapi');
    expect(requirementsTxt).toContain('pytest');

    const projectToml = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/ReceiptOcr/project.toml'),
      'utf8',
    );
    expect(projectToml).toContain('id = "heroku/python"');
    expect(projectToml).toContain('id = "heroku/heroku-applink"');
    expect(projectToml).toContain('id = "heroku/procfile"');

    const readme = await readFile(
      join(projectDir, 'force-app/main/default/computeApps/ReceiptOcr/README.md'),
      'utf8',
    );
    expect(readme).toContain('sf plugins install @salesforce/plugin-deploy-retrieve@compute');
    expect(readme).toContain('sf project deploy start --metadata ComputeApp:ReceiptOcr --target-org <org>');
  });

  it('scaffolds into a custom --output-dir', async () => {
    const result = await Generate.run(['--name', 'CustomDir', '--output-dir', 'custom/compute']);

    expect(result.path).toBe(join('custom/compute', 'CustomDir'));
  });

  it('fails when the app already exists', async () => {
    await Generate.run(['--name', 'Dup']);

    await expect(Generate.run(['--name', 'Dup'])).rejects.toThrow('already exists');
  });

  it('rejects a name that would traverse outside the output directory', async () => {
    await expect(Generate.run(['--name', '../evil'])).rejects.toThrow("isn't valid");
  });

  it('surfaces a clear error when the template source fetch fails', async () => {
    Generate.fetchTemplateSource = async () => {
      throw new Error('boom');
    };

    await expect(Generate.run(['--name', 'FetchFails'])).rejects.toThrow('boom');
  });

  it('surfaces a clear error when the fetched source is missing an expected file', async () => {
    Generate.fetchTemplateSource = async () => ({});

    await expect(Generate.run(['--name', 'MissingFile'])).rejects.toThrow('Procfile');
  });

  it('omits upstream governance files and example tests from the node app', async () => {
    const result = await Generate.run(['--name', 'CleanNode']);
    const relative = result.files.map(f => appRelative(f, 'CleanNode'));

    const denied = new Set(['app.json', 'CODEOWNERS', 'LICENSE.txt', 'test/routes/accounts.test.js']);
    expect(relative.filter(f => denied.has(f))).toEqual([]);
  });

  it('omits upstream governance files, example routers, and example router tests from the python app', async () => {
    const result = await Generate.run(['--name', 'CleanPython', '--language', 'python']);
    const relative = result.files.map(f => appRelative(f, 'CleanPython'));

    const denied = new Set(['app/routers/accounts.py', 'SECURITY.md', 'tests/routers/test_accounts.py']);
    expect(relative.filter(f => denied.has(f))).toEqual([]);

    // The upstream tests that still pass against the skeleton are kept.
    expect(relative).toContain('tests/test_main.py');
  });

  it('retargets the invoke scripts away from endpoints the generated app does not have', async () => {
    await Generate.run(['--name', 'InvokeNode']);
    await Generate.run(['--name', 'InvokePython', '--language', 'python']);
    const base = join(projectDir, 'force-app/main/default/computeApps');

    const nodeScript = await readFile(join(base, 'InvokeNode/bin/invoke.sh'), 'utf8');
    // eslint-disable-next-line no-template-curly-in-string
    expect(nodeScript).toContain('${6:-/healthcheck}');
    expect(nodeScript).toContain('POST /hello');
    expect(nodeScript).not.toContain('/accounts');
    expect(nodeScript).not.toContain('/unitofwork');

    const pythonScript = await readFile(join(base, 'InvokePython/bin/invoke.py'), 'utf8');
    expect(pythonScript).not.toContain('accounts');
    expect(pythonScript).toContain('/health');
  });

  it('fails at generate time when the fetched source lacks a file the app needs to run', async () => {
    Generate.fetchTemplateSource = async language => {
      const entries = await stubFetchTemplateSource(language);
      delete entries['package-lock.json'];
      return entries;
    };

    await expect(Generate.run(['--name', 'NoLockfile'])).rejects.toThrow('package-lock.json');
  });
});
