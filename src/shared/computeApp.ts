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

import {Messages} from '@salesforce/core';
import {access} from 'node:fs/promises';
import {basename, join} from 'node:path';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Mirrors Salesforce's DeveloperName grammar (starts with a letter, alphanumeric/underscore only,
// no trailing or double underscore) -- every --name is now resolved as a DeveloperName via SOQL,
// so this also guards against path traversal, since `name` is joined directly into a filesystem path.
const NAME_PATTERN = /^(?!.*__)(?!.*_$)[A-Za-z]\w*$/;

// Mirrors Salesforce's namespace grammar (starts with a letter, alphanumeric/underscore only,
// 1-15 characters total, no double underscore).
const NAMESPACE_PATTERN = /^[A-Za-z](?!.*__)[A-Za-z0-9_]{0,14}$/;

export type ParsedComputeAppName = {
  developerName: string;
  namespace?: string;
};

// Splits a --name value on its first "__" into { namespace, developerName } when it's a
// namespace-qualified metadata name (<namespace>__<developerName>), validating each part against
// its own Salesforce grammar; otherwise validates the whole string as a bare DeveloperName. A
// DeveloperName can never itself contain "__" (see NAME_PATTERN's lookahead), so any "__" in --name
// means everything before the first one is a namespace -- DeveloperName and Namespace are separate
// compound-key fields (see PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md), not one combined identifier.
export function parseName(name: string): ParsedComputeAppName {
  const separatorIndex = name.indexOf('__');
  if (separatorIndex === -1) {
    if (!NAME_PATTERN.test(name)) {
      throw messages.createError('error.invalidName', [name]);
    }

    return {developerName: name};
  }

  const namespace = name.slice(0, separatorIndex);
  const developerName = name.slice(separatorIndex + 2);
  if (!NAMESPACE_PATTERN.test(namespace) || !NAME_PATTERN.test(developerName)) {
    throw messages.createError('error.invalidName', [name]);
  }

  return {namespace, developerName};
}

// Shared by every command that takes --name, so the path-traversal/SOQL-injection guard has one
// source of truth. Delegates to parseName so a <namespace>__<developerName> value is accepted too.
export function validateName(name: string): void {
  parseName(name);
}

export function resolveAppDir(outputDir: string, name: string): string {
  return join(outputDir, name);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// The same "does this look like a compute app's own directory" check deploy.ts uses to derive
// its app name from cwd, reused here as the last resort in the --name/COMPUTE_APP_NAME/directory
// fallback chain shared by every other command that takes --name.
export async function resolveComputeAppNameFromDir(dir: string): Promise<string | undefined> {
  const name = basename(dir);
  return (await pathExists(join(dir, `${name}.compute-meta.xml`))) ? name : undefined;
}

// Shared by every command in the --name/COMPUTE_APP_NAME/directory fallback chain, so the
// "couldn't figure out which app" error is thrown identically everywhere instead of duplicated.
export function requireAppName(name: string | undefined): string {
  if (!name) {
    throw messages.createError('error.cannotResolveAppName');
  }

  return name;
}
