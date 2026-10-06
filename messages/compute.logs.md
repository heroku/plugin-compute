# summary

Print or stream the runtime log for a compute app.

# description

Fetches a compute app's runtime log -- this is the app's ongoing output
(request handling, application logs), not the build/compile log; use
compute get build-log for that.

This is an org-mediated operation by --name (the app's DeveloperName) -- the
org creates a log session with Heroku on your behalf and hands back a
short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
read from or require a local Salesforce DX project.

By default this prints the most recent log lines and exits. Pass --tail to
keep the session open and print new lines as they arrive, until you stop it
with Ctrl-C or the session ends on its own.

--tail can't be combined with --json, since a live stream has no single
point at which to emit one JSON result.

# flags.name.summary

DeveloperName of the compute app to fetch logs for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# flags.num.summary

Number of historical log lines to print before new output.

# flags.tail.summary

Keep the session open and print new log lines as they arrive.

# info.noBuildsFound

Compute app %s has no builds yet, so it has no logs.

# info.noLogLines

Compute app %s has no log output yet.

# info.tailStarting

Tailing logs for %s. Press Ctrl-C to stop.

# info.tailStopped

Stopped tailing %s.

# info.tailStreamEnded

The log session for %s ended.

# examples

- Print the most recent log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Print the most recent 500 log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --num 500 --target-org my-org

- Tail the log until stopped with Ctrl-C:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --tail --target-org my-org
