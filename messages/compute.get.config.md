# summary

Print one or more of a compute app's config var values.

# description

Goes through the target org's Salesforce Connect API, which calls Heroku on
your behalf. Pass a single key to print its bare value, or more than one to
print each as key: value. Fails if any requested key isn't currently set.

# args.key.summary

Config var name to print. Pass more than one to print multiple values in
one command.

# flags.name.summary

DeveloperName of the compute app to read config from (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# examples

- Print a single config var's value:

  <%= config.bin %> <%= command.id %> STRIPE_KEY --name CreditRatingScorer --target-org my-org

- Print more than one config var:

  <%= config.bin %> <%= command.id %> STRIPE_KEY LOG_LEVEL --name CreditRatingScorer --target-org my-org

# error.configGetNoKeysSpecified

Specify at least one config var to get, for example STRIPE_KEY.

# error.configGetNoKeysSpecified.actions

- Run the command again with at least one config var name.
