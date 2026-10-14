# summary

Show the full detail of a single compute telemetry drain.

# description

Fetches one OpenTelemetry drain by its ID and shows the app it belongs to,
the signals it forwards, and its exporter endpoint, transport, and headers.
Goes through the target org's Salesforce Connect API, which calls Heroku on
your behalf. The drain ID globally identifies the drain, so this command
takes no --name: the owning app is derived from the drain itself. Use
sf compute telemetry-drain list to find a drain's ID.

This is a read-only, live lookup -- it doesn't read from or require a local
Salesforce DX project.

# args.id.summary

ID of the telemetry drain to show.

# examples

- Show the detail of a telemetry drain by its ID:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --target-org my-org
