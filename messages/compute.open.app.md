# summary

Open the Compute Dashboard for an org or one of its compute apps in a browser.

# description

Opens the Compute Dashboard in your browser, signed in to the target org. With no --name, opens the dashboard home; with --name (or COMPUTE_APP_NAME), opens that app's page. The URL is always built on the org's Lightning domain, which is the only domain that serves the dashboard.

An optional ROUTE argument is appended to the app's page URL. It requires an app, may omit the leading /, and may include a query string and fragment, but must be a route only (no scheme or host). Use --url-only to print the plain dashboard URL (no session token) instead of launching a browser; with --json, no browser is launched either.

# args.route.summary

Route within the Compute Dashboard to open, relative to the app's page. Requires --name (or COMPUTE_APP_NAME). A leading / is optional. May include a query string or fragment.

# flags.name.summary

DeveloperName of the compute app to open (or <namespace>\_\_<developerName> if it was deployed under a namespace). Defaults to the COMPUTE_APP_NAME environment variable. If neither is set, opens the dashboard home.

# flags.browser.summary

Browser to open the dashboard in. Defaults to your system's default browser.

# flags.url-only.summary

Print the dashboard URL without opening a browser.

# error.routeRequiresName

A route requires a compute app name.

# error.routeRequiresName.actions

- Pass --name <app>, or set the COMPUTE_APP_NAME environment variable.
- Omit the route to open the dashboard home.

# error.frontdoorFailed

Couldn't create a signed-in link for the Compute Dashboard (%s). The dashboard URL is: %s

# error.frontdoorFailed.actions

- Run the command again with --url-only to print the URL, then open it yourself.
- Re-authenticate with "sf org login web --target-org <org>" and try again.

# info.opening

Opening the Compute Dashboard: %s

# warning.browserLaunchFailed

Couldn't launch a browser (%s). Open this URL manually: %s

# examples

- Open the Compute Dashboard home:

  <%= config.bin %> <%= command.id %> --target-org my-org

- Open the dashboard page for a compute app:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Open a route within a compute app's dashboard page:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org resources

- Open a route that includes a query string (name taken from the COMPUTE_APP_NAME environment variable):

  $ COMPUTE_APP_NAME=CreditRatingScorer <%= config.bin %> <%= command.id %> --target-org my-org "resources?tab=logs"

- Open the dashboard in Firefox:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org --browser firefox

- Print the dashboard URL without opening a browser:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org --url-only
