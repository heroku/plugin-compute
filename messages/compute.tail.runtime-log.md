# summary

Stream the live runtime log for a compute app.

# description

Streams a compute app's runtime log -- the app's ongoing output (request
handling, application logs), not the build/compile log; use compute get
build-log for that.

Keeps the session open and prints new log lines as they arrive, until you stop
it with Ctrl-C or the session ends on its own. For a one-time snapshot of the
most recent lines, use compute get runtime-log.

This is an org-mediated operation by --name (the app's DeveloperName) -- the
org creates a log session with Heroku on your behalf and hands back a
short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
read from or require a local Salesforce DX project.

# flags.name.summary

DeveloperName of the compute app to tail logs for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# flags.num.summary

Number of recent log lines to print before streaming new output.

# info.noBuildsFound

Compute app %s has no builds yet, so it has no logs.

# info.tailStarting

Tailing logs for %s. Press Ctrl-C to stop.

# info.tailStopped

Stopped tailing %s.

# info.tailStreamEnded

The log session for %s ended.

# info.tailReconnecting

The log session for %s expired; reconnecting.

# warning.generationUnknown

Couldn't tell whether %s is a Fir or Cedar app, so it's being read as a Cedar app. If it's a Fir app, its log output may be missing or delayed; run the command again.

# warning.tailEndedWithoutOutput

The log session for %s closed without sending any log lines. The app may have produced no output yet; run the command again, or check that the app is running.

# examples

- Tail the log until stopped with Ctrl-C:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Print the most recent 500 lines, then keep streaming:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --num 500 --target-org my-org
