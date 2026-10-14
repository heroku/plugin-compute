# summary

Show the full detail of a single compute telemetry drain.

# description

Shows the app a single OpenTelemetry drain belongs to, the signals it
forwards, and its exporter endpoint, transport, and headers. Use
sf compute telemetry-drain list to find a drain's ID.

# args.id.summary

ID of the telemetry drain to show.

# examples

- Show the detail of a telemetry drain by its ID:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --target-org my-org
