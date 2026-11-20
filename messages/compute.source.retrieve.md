# summary

Show how to retrieve a compute app.

# description

This command no longer retrieves compute apps. Install the Compute variant of
the deploy-retrieve plugin and use project retrieve start from your Salesforce
DX project instead.

# examples

- Install the plugin and retrieve a compute app:

  <%= config.bin %> plugins install @salesforce/plugin-deploy-retrieve@compute

  <%= config.bin %> project retrieve start --metadata ComputeApp:my_app --target-org my-org

# error.migrate

This command no longer retrieves compute apps.

# error.migrate.actions

- Run sf plugins install @salesforce/plugin-deploy-retrieve@compute.
- From your Salesforce DX project, run sf project retrieve start --metadata ComputeApp:<app-name> --target-org <org>.
