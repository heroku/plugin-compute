# summary

Change the configuration of a compute telemetry drain.

# description

Updates only the attributes you pass and leaves the rest of the drain as it
is. Passing --header adds or overwrites the headers you give and keeps the
drain's other headers. Use sf compute list telemetry-drain to find a drain's ID.

# args.id.summary

ID of the telemetry drain to update.

# flags.url.summary

New endpoint to forward telemetry to.

# flags.signals.summary

New comma-separated signals to forward: traces, metrics, logs, or all.

# flags.transport.summary

New wire protocol: http (OTLP over HTTP) or grpc (OTLP over gRPC).

# flags.header.summary

Header to send with each export, as key=value.

# flags.header.description

Repeat the flag to send more than one header. A header you pass adds
or overwrites the one with the same name; the drain's other headers are kept. Header values often carry credentials; they are
never printed to the terminal or --json output; header keys are preserved with redacted values.

# error.nothingToUpdate

Nothing to update. Pass at least one of --url, --signals, --transport, or --header.

# error.nothingToUpdate.actions

- Pass the attribute you want to change, for example --url https://collector.example.com:4318.

# info.updated

Updated telemetry drain %s.

# examples

- Point a drain at a new endpoint:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --url https://collector.example.com:4318 --target-org my-org

- Forward only logs over gRPC:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --signals logs --transport grpc --target-org my-org
