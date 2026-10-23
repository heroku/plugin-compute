# summary

Show how to deploy a compute app.

# description

This command no longer deploys compute apps. Install the Compute variant of
the deploy-retrieve plugin and use project deploy start from your Salesforce
DX project instead.

# examples

- Install the plugin and deploy a compute app:

  <%= config.bin %> plugins install @salesforce/plugin-deploy-retrieve@compute

  <%= config.bin %> project deploy start --metadata PlatformComputeApp:my_app --target-org my-org

# error.migrate

This command no longer deploys compute apps.

# error.migrate.actions

- Run sf plugins install @salesforce/plugin-deploy-retrieve@compute.
- From your Salesforce DX project, run sf project deploy start --metadata PlatformComputeApp:<app-name> --target-org <org>.
