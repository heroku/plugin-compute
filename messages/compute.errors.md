# error.invalidName

The name "%s" isn't valid. Use only letters, numbers, and underscores, and start with a letter.

# error.cannotResolveAppName

Couldn't determine which compute app to use.

# error.cannotResolveAppName.actions

- Pass --name explicitly.
- Set the COMPUTE_APP_NAME environment variable.
- cd into the compute app's own directory (the one with its <name>.compute-meta.xml file) and run the command again.

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

- cd into the compute app's directory and run sf compute deploy --target-org <org> to deploy it.
- Check that the app's directory name matches the DeveloperName used when it was deployed.

# error.ambiguousName

Found more than one compute app named %s in the org.

# error.ambiguousName.actions

- This isn't expected; contact your Salesforce admin.

# error.queryFailed

Couldn't query compute app details: %s

# error.queryFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.buildOutputFetchFailed

Couldn't fetch build output: %s

# error.buildOutputFetchFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.logSessionCreateFailed

Couldn't create a log session: %s

# error.logSessionCreateFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.logStreamFailed

Couldn't read the log stream: %s

# error.logStreamFailed.actions

- Run the command again; the log session may have expired.
- If the problem persists, check your network connection to logplex.heroku.com.

# error.herokuAppNotFound

Heroku didn't find an app named %s. HEROKU_API_TOKEN mode uses --name directly as the Heroku app name, bypassing the org -- this fails if the compute app's DeveloperName doesn't match its actual Heroku app name.

# error.herokuAppNotFound.actions

- Confirm the Heroku app is actually named the same as --name, or unset HEROKU_API_TOKEN to fall back to the org-mediated Connect API path.
- Run `heroku apps:info --app <app-name>` to confirm the app's real name on Heroku.

# error.herokuAuthFailed

Heroku rejected the request: %s

# error.herokuAuthFailed.actions

- Confirm HEROKU_API_TOKEN is set to a valid, unexpired token with access to this app.
- Run `heroku auth:token` to get a fresh token, or unset HEROKU_API_TOKEN to fall back to the org-mediated Connect API path.

# error.herokuApiRequestFailed

Couldn't reach the Heroku Platform API: %s

# error.herokuApiRequestFailed.actions

- Confirm HEROKU_API_TOKEN is valid and the app is reachable.
- Run the command again; if it still fails, check Heroku's status page.

# error.herokuFormationNotFound

Heroku didn't find app %s or its %s process type. HEROKU_API_TOKEN mode uses --name directly as the Heroku app Id or name, bypassing the org -- this fails if that doesn't match an actual Heroku app, or if the process type doesn't exist on that app.

# error.herokuFormationNotFound.actions

- Confirm the Heroku app Id/name and process type are correct, or unset HEROKU_API_TOKEN to fall back to the org-mediated Connect API path.
- Run `heroku ps --app <app-name>` to list the app's actual process types.

# error.formationUpdateFailed

Couldn't update the compute app's dyno formation: %s

# error.formationUpdateFailed.actions

- Confirm the target org has compute apps enabled and that you have the ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.configVarsFetchFailed

Couldn't fetch the compute app's config vars: %s

# error.configVarsFetchFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.configVarsUpdateFailed

Couldn't update the compute app's config vars: %s

# error.configVarsUpdateFailed.actions

- Confirm the target org has compute apps enabled and that you have the ManageCompute permission.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.configVarNotFound

%s has no config var named "%s".

# error.configVarNotFound.actions

- Run sf compute config --name <name> --target-org <org> to see the app's current config vars.

# error.metadataRetrieveFailed

Couldn't retrieve metadata for compute app %s: %s

# error.metadataRetrieveFailed.actions

- Confirm the app has been deployed to this org (run sf compute deploy first).
- Check that --name matches the DeveloperName used when it was deployed.

# error.sourceDownloadFailed

Couldn't download the compute app's source: %s

# error.sourceDownloadFailed.actions

- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.
- Confirm the app has been deployed to this org (run sf compute deploy first).

# error.sourceBundleMalformed

The downloaded deployment bundle is invalid: %s.

# error.sourceBundleMalformed.actions

- Run sf compute source retrieve again; if it still fails, contact your Salesforce admin.
