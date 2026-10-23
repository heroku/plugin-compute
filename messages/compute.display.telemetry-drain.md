# summary

Show the full detail of a single compute telemetry drain.

# description

Shows a single OpenTelemetry drain in full: the compute app it belongs to,
the signals it forwards, and its exporter endpoint, transport, and headers.
Use sf compute list telemetry-drain to find a drain's ID.
Header values are redacted in both human-readable and --json output; header keys are preserved.

# args.id.summary

ID of the telemetry drain to show.

# examples

- Show the detail of a telemetry drain by its ID:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --target-org my-org
