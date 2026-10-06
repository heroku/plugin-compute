# summary

List a compute app's config vars.

# description

Shows every config var (environment variable) currently set for a deployed
compute app, sorted alphabetically. Goes through the target org's Salesforce
Connect API, which calls Heroku on your behalf. Use sf compute config get to
read a single var's value, sf compute config set to add or change vars, or
sf compute config unset to remove them.

# flags.name.summary

DeveloperName of the compute app to list config vars for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# examples

- List all config vars for a compute app:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org
