# summary

Show how to deploy a compute app.

# description

This command no longer deploys compute apps. Install the Compute variant of
the deploy-retrieve plugin and use project deploy start instead.

# examples

- Install the plugin and deploy a compute app:

  <%= config.bin %> plugins install @salesforce/plugin-deploy-retrieve@compute

  <%= config.bin %> project deploy start --target-org my-org

# warning.migrate

To deploy a compute app, run sf plugins install @salesforce/plugin-deploy-retrieve@compute, then use project deploy start.
