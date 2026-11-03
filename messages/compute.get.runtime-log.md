# summary

Print the recent runtime log for a compute app.

# description

Fetches a compute app's runtime log -- the app's ongoing output (request
handling, application logs), not the build/compile log; use compute get
build-log for that.

This prints the most recent log lines and exits. To keep the session open and
stream new lines as they arrive, use compute tail runtime-log.

The recent lines come from the Cedar log buffer (about 1500 lines at most), so
--num can't return more than that. Fir apps keep no log history, so for them
the command reads the live log session instead and stops once it goes quiet
for a few seconds; it can only show output the session delivers in that
window, so use compute tail runtime-log to follow a Fir app's log. The
command stops waiting after 30 seconds and prints whatever log lines it has
received by then; if none arrived, it fails with a timeout error.

This is an org-mediated operation by --name (the app's DeveloperName) -- the
org creates a log session with Heroku on your behalf and hands back a
short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
read from or require a local Salesforce DX project.

# flags.name.summary

DeveloperName of the compute app to fetch logs for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# flags.num.summary

Number of recent log lines to print.

# warning.logFetchPartial

The log output didn't finish arriving in time, so only the lines received so far are shown.

# info.noBuildsFound

Compute app %s has no builds yet, so it has no logs.

# info.noLogLines

Compute app %s has no log output yet.

# examples

- Print the most recent log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Print the most recent 500 log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --num 500 --target-org my-org
