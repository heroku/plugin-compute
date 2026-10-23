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

// Placeholder for a drain field the platform left unset -- matches the dash the other compute
// tables use so single-drain display reads consistently.
const DASH = '-';

// Exporter headers routinely carry credentials, so both human and JSON output mask every value.
// Mask a copy to preserve credentials in API requests and the caller's drain object.
const REDACTED = '<redacted>';

export function maskHeaderValues(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map(key => [key, REDACTED]));
}

// The three OpenTelemetry signal categories a drain can forward. Order matches the
// TelemetryDrain.signals enum in the platform API spec; `all` is the shorthand for every one.
export const TELEMETRY_SIGNALS: readonly TelemetrySignal[] = ['traces', 'metrics', 'logs'];

// User-facing --transport values and the exporter type each one maps to. `grpc`/`http` are the two
// OTLP wire protocols; `splunk` is its own exporter. Reversed for display by
// transportLabelForExporterType below.
const TRANSPORT_TO_EXPORTER = {
  grpc: 'otlp',
  http: 'otlphttp',
  splunk: 'splunk',
} as const satisfies Record<string, TelemetryExporterType>;

export const TELEMETRY_TRANSPORTS: readonly string[] = Object.keys(TRANSPORT_TO_EXPORTER);

// The transports advertised to users (error text, hints). `splunk` is still accepted but stays hidden.
export const PUBLIC_TRANSPORTS: readonly string[] = ['http', 'grpc'];

type TelemetryTransport = keyof typeof TRANSPORT_TO_EXPORTER;

// DELIBERATELY case-sensitive, non-trimming, and treats `all` only as the whole input (never as a
// comma-separated element). This is an explicit decision, not an oversight: the plugin is pre-GA and
// no command consumes this yet, so staying strict now is the safe direction -- leniency (trimming,
// case-insensitivity) can be loosened later without breaking anyone, whereas tightening after GA
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

// Maps a user-facing --transport onto its exporter type. Same strictness as signals above
// (exact-match, no trim/case-fold); an unknown transport throws rather than silently defaulting.
export function exporterTypeForTransport(transport: string): TelemetryExporterType {
  if (!Object.hasOwn(TRANSPORT_TO_EXPORTER, transport)) {
    const publicList = PUBLIC_TRANSPORTS.join(', ');
    throw messages.createError('error.invalidTransport', [transport, publicList], [publicList]);
  }

  return TRANSPORT_TO_EXPORTER[transport as TelemetryTransport];
}

// Display label for an exporter type: only `otlp` is gRPC; `otlphttp` and `splunk` both ride HTTP.
export function transportLabelForExporterType(exporterType: string): string {
  return exporterType === 'otlp' ? 'gRPC' : 'HTTP';
}

// Builds the ordered key/value rows for a single-drain display. App-only: the app name is passed in
// (already resolved by the command from the drain's own owner -- see display/telemetry-drain.ts), not
// re-derived here, since this foundation never looks owners up. `compute display telemetry-drain` renders these rows.
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

// Splits on the first = only, so a header value that itself contains one (e.g. a base64 token's
// padding) isn't truncated. Requires a non-empty key; an empty value is allowed.
const HEADER_PATTERN = /^([^=]+)=(.*)$/v;

// Turns repeated --header key=value flags into the exporter headers object. A repeated key keeps its
// last value. Built via fromEntries so a key like `__proto__` becomes an own property rather than
// touching the prototype.
export function parseHeaderFlags(inputs: readonly string[]): Record<string, string> {
  const entries = inputs.map((input): [string, string] => {
    const match = HEADER_PATTERN.exec(input);
    if (!match) {
      throw messages.createError('error.invalidHeader');
    }

    return [match[1], match[2]];
  });

  return Object.fromEntries(entries);
}

// Command-owned result shape (not the raw wire type) so --json stays stable across OpenAPI changes.
// Shared by create/update; display keeps its own because it also resolves the owning app.
export type TelemetryDrainResult = {
  endpoint?: string;
  // The raw exporter type, so --json can tell otlphttp and splunk apart (both collapse to "HTTP").
  exporterType?: string;
  headers?: Record<string, string>;
  id: string;
  signals: string[];
  transport?: string;
};

export function toTelemetryDrainResult(drain: components['schemas']['TelemetryDrain']): TelemetryDrainResult {
  return {
    id: drain.id ?? '',
    signals: drain.signals ?? [],
    endpoint: drain.exporter?.endpoint,
    exporterType: drain.exporter?.type,
    transport: drain.exporter?.type ? transportLabelForExporterType(drain.exporter.type) : undefined,
    headers: drain.exporter?.headers === undefined ? undefined : maskHeaderValues(drain.exporter.headers),
  };
}
