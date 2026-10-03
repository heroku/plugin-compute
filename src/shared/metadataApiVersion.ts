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

import type {Connection} from '@salesforce/core';

// PlatformComputeApp was introduced as a metadata type in API 68.0. Deploying/retrieving it at
// a lower version (e.g. an org's negotiated default, or a lower sourceApiVersion in
// sfdx-project.json) makes the server fail to resolve the type before it ever inspects the zip
// contents against package.xml -- surfacing as the misleading "was named in package.xml, but was
// not found in zipped directory" error rather than an explicit unsupported-type error.
const MIN_API_VERSION = 68;

export function resolveComputeApiVersion(connection: Connection): string {
  return Math.max(Number(connection.getApiVersion()), MIN_API_VERSION).toFixed(1);
}
