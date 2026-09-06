# summary

Unset one or more of a compute app's config vars.

# description

Goes through the target org's Salesforce Connect API, which calls Heroku on
your behalf. Unsetting a config var restarts the app's dynos so the removal
takes effect. Fails if any requested key isn't currently set.

# args.key.summary

Config var name to unset. Pass more than one to unset multiple config vars
in one command.

# flags.name.summary

PlatformComputeApp Id or DeveloperName of the compute app to change config
for. Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# examples

- Unset a single config var:

  <%= config.bin %> <%= command.id %> LOG_LEVEL --name CreditRatingScorer --target-org my-org

- Unset more than one config var in one command:

  <%= config.bin %> <%= command.id %> LOG_LEVEL DEBUG_MODE --name CreditRatingScorer --target-org my-org

# error.configUnsetNoKeysSpecified

Specify at least one config var to unset, for example STRIPE_KEY.

# error.configUnsetNoKeysSpecified.actions

- Run the command again with at least one config var name.
