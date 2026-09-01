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

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Also guards against path traversal, since `name` is joined directly into a filesystem path.
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// Shared by every command that takes --name, so the path-traversal guard has one source of truth.
export function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw messages.createError('error.invalidName', [name]);
  }
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
