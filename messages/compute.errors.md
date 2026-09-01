# error.invalidName

The name "%s" isn't valid. Use only letters, numbers, and underscores, and start with a letter.

# error.connectApiRequestFailed

Couldn't reach the Salesforce Connect API: %s

# error.connectApiRequestFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.metadataDeployFailed

Couldn't deploy metadata for compute app %s: %s

# error.metadataDeployFailed.actions

- Check the error detail above for the specific component failure.
- Fix the issue and run the deploy again.

# error.appNotFoundInOrg

No compute app named %s was found in the org. It may not have been deployed yet, or it was deployed under a different name.

# error.appNotFoundInOrg.actions

- Run <%= config.bin %> compute deploy --name %s --target-org <org> to deploy it.
- Check that --name matches the DeveloperName used when it was deployed.

# error.ambiguousName

Found more than one compute app named %s in the org.

# error.ambiguousName.actions

- This isn't expected; contact your Salesforce admin.

# error.queryFailed

Couldn't query compute app details: %s

# error.queryFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.
