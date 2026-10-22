# summary

Print the recent runtime log for a compute app.

# description

Fetches a compute app's runtime log -- the app's ongoing output (request
handling, application logs), not the build/compile log; use compute get
build-log for that.

This prints the most recent log lines and exits. To keep the session open and
stream new lines as they arrive, use compute tail runtime-log.

The recent lines come from the Cedar log buffer (about 1500 lines at most), so
--num can't return more than that. Fir apps keep no log history, so this
command isn't supported for them; use compute tail runtime-log instead. The
command gives up if the log output doesn't arrive within 30 seconds.

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

Number of recent log lines to print, served from the Cedar log buffer. Not supported for Fir apps.

# error.firNoLogHistory

Fir apps keep no log history, so there is no recent log to fetch for %s.

# error.firNoLogHistory.actions

- Run sf compute tail runtime-log to watch the live log instead.

# info.noBuildsFound

Compute app %s has no builds yet, so it has no logs.

# info.noLogLines

Compute app %s has no log output yet.

# examples

- Print the most recent log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Print the most recent 500 log lines:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --num 500 --target-org my-org
