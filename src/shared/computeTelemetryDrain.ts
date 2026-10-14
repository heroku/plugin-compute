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

import type {components} from '../generated/heroku-platform-api.js';
import type {TelemetryExporterType, TelemetrySignal} from './herokuProxyApi.js';

import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// Placeholder for a drain field Heroku left unset -- matches the dash HerokuAppSummary/formation
// rendering uses so single-drain display reads consistently with the other compute tables.
const DASH = '-';

// Exporter header values routinely carry credentials (bearer / Splunk-HEC tokens). The human table
// masks the VALUES (keys stay visible so an operator can still see which headers are set) so a secret
// can't leak into terminal scrollback, screen-shares, or screenshots. The machine-readable --json
// result keeps them verbatim -- same trust boundary as the authenticated caller (see telemetry-drain/
// get.ts). Masks a copy; never mutates the caller's drain object.
const REDACTED = '<redacted>';

function maskHeaderValues(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map(key => [key, REDACTED]));
}

// The three OpenTelemetry signal categories a drain can forward. Order matches the enum in
// api-specs/heroku-platform-api.yaml (TelemetryDrain.signals); `all` is the shorthand for every one.
export const TELEMETRY_SIGNALS: readonly TelemetrySignal[] = ['traces', 'metrics', 'logs'];

// User-facing --transport values and the exporter type each maps to on Heroku's side. `grpc`/`http`
// are the two OTLP wire protocols; `splunk` is its own exporter. Reversed for display by
// transportLabelForExporterType below.
const TRANSPORT_TO_EXPORTER = {
  grpc: 'otlp',
  http: 'otlphttp',
  splunk: 'splunk',
} as const satisfies Record<string, TelemetryExporterType>;

export const TELEMETRY_TRANSPORTS: readonly string[] = Object.keys(TRANSPORT_TO_EXPORTER);

type TelemetryTransport = keyof typeof TRANSPORT_TO_EXPORTER;

// Ported from heroku/cli's `telemetry` command. DELIBERATELY case-sensitive, non-trimming, and
// treats `all` only as the whole input (never as a comma-separated element) -- preserving behavioral
// parity with heroku/cli. This is an explicit decision, not an oversight: the plugin is pre-GA and no
// command consumes this yet, so staying strict now is the safe direction -- leniency (trimming,
// case-insensitivity) can be loosened in later without breaking anyone, whereas tightening after GA
// would break users. The companion unit tests lock each quirk (`Traces`/` traces`/`all,logs` all throw).
export function validateAndFormatSignals(input: string): TelemetrySignal[] {
  if (input === 'all') {
    return [...TELEMETRY_SIGNALS];
  }

  const requested = input.split(',');
  const invalid = requested.filter(signal => !(TELEMETRY_SIGNALS as readonly string[]).includes(signal));
  if (invalid.length > 0) {
    throw messages.createError('error.invalidSignal', [invalid.join(', '), [...TELEMETRY_SIGNALS, 'all'].join(', ')]);
  }

  return requested as TelemetrySignal[];
}

// Maps a user-facing --transport onto Heroku's exporter type. Same strictness as signals above
// (exact-match, no trim/case-fold); an unknown transport throws rather than silently defaulting.
export function exporterTypeForTransport(transport: string): TelemetryExporterType {
  if (!Object.hasOwn(TRANSPORT_TO_EXPORTER, transport)) {
    throw messages.createError('error.invalidTransport', [transport, TELEMETRY_TRANSPORTS.join(', ')]);
  }

  return TRANSPORT_TO_EXPORTER[transport as TelemetryTransport];
}

// Display label for an exporter type: only `otlp` is gRPC; `otlphttp` and `splunk` both ride HTTP.
export function transportLabelForExporterType(exporterType: string): string {
  return exporterType === 'otlp' ? 'gRPC' : 'HTTP';
}

// Builds the ordered key/value rows for a single-drain display. App-only: the app name is passed in
// (already resolved by the command from the drain's own owner -- see telemetry-drain/get.ts), not
// re-derived here, since this foundation never looks owners up. `telemetry-drain get` renders these rows.
export function formatTelemetryDrainRows(
  drain: components['schemas']['TelemetryDrain'],
  appName: string,
): Array<{key: string; value: string}> {
  const headers = drain.exporter?.headers;
  const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;

  return [
    {key: 'App', value: appName},
    {key: 'Signals', value: drain.signals && drain.signals.length > 0 ? drain.signals.join(', ') : DASH},
    {key: 'Endpoint', value: drain.exporter?.endpoint ?? DASH},
    {key: 'Transport', value: drain.exporter?.type ? transportLabelForExporterType(drain.exporter.type) : DASH},
    {key: 'Headers', value: hasHeaders ? JSON.stringify(maskHeaderValues(headers)) : DASH},
  ];
}
