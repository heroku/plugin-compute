# summary

Delete a compute telemetry drain.

# description

Removes a single OpenTelemetry drain by its ID, so its compute app stops
forwarding logs, metrics, and traces to the drain's endpoint. This can't be
undone; to forward telemetry again, create a new drain. You're asked to
confirm first unless you pass --no-prompt. Use sf compute list telemetry-drain
to find a drain's ID.

# args.id.summary

ID of the telemetry drain to delete.

# flags.no-prompt.summary

Don't ask for confirmation before deleting.

# info.confirm

Delete telemetry drain %s? This stops forwarding telemetry to its endpoint.

# info.aborted

Telemetry drain %s was not deleted.

# info.deleted

Deleted telemetry drain %s.

# examples

- Delete a telemetry drain, confirming first:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --target-org my-org

- Delete a telemetry drain without the confirmation prompt, for scripts:

  <%= config.bin %> <%= command.id %> 01234567-89ab-cdef-0123-456789abcdef --target-org my-org --no-prompt
