# error.invalidName

The name "%s" isn't valid. Use only letters, numbers, and underscores, start with a letter, and
don't use two consecutive underscores. For a namespace-qualified name
(<namespace>\_\_<developerName>), both parts must independently follow those rules, and the
namespace must be 15 characters or fewer.

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

# error.logStreamFailed

Couldn't read the log stream: %s

# error.logStreamFailed.actions

- Run the command again; the log session may have expired.
- If the problem persists, check your network connection to logplex.heroku.com.

# error.herokuAppNotFound

Heroku didn't find an app named %s.

# error.herokuAppNotFound.actions

- Confirm the compute app's DeveloperName matches its actual Heroku app name.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.herokuApiRequestFailed

Couldn't reach the Heroku Platform API through Salesforce: %s

# error.herokuApiRequestFailed.actions

- Run the command again; if it still fails, check Heroku's status page.
- Confirm the target org has compute apps enabled and that you have the DeployCompute or ManageCompute permission.

# error.herokuProxyRequestFailed

The Salesforce Heroku API proxy rejected the request: %s

# error.herokuProxyRequestFailed.actions

- Confirm the target org supports the Heroku API proxy (API version 68.0 or later).
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.herokuRequestRejected

Heroku rejected the request: %s

# error.herokuRequestRejected.actions

- Read the detail above for exactly what Heroku reported.
- If it names an invalid value (for example an endpoint URL or a signal/exporter combination), fix it and run the command again.
- If it points to a temporary problem or a permissions issue, retry in a moment or confirm you have the required access, then run the command again.

# error.herokuFormationNotFound

Heroku didn't find app %s or its %s process type.

# error.herokuFormationNotFound.actions

- Confirm the process type is correct.
- Run the command again; if it still fails, check Setup for outstanding compute app errors.

# error.herokuAppIdentifierUnavailable

Compute app %s doesn't have a Heroku app identifier yet.

# error.herokuAppIdentifierUnavailable.actions

- Wait for the app's current build to finish, then run the command again.
- If the app has never had a successful build, run sf compute deploy first.

# error.configVarNotFound

%s has no config var named "%s".

# error.configVarNotFound.actions

- Run sf compute list config --name <name> --target-org <org> to see the app's current config vars.

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

# error.templateSourceFetchFailed

Couldn't fetch the %s starter source: %s

# error.templateSourceFetchFailed.actions

- Check your network connection to github.com and codeload.github.com.
- Run the command again; if it still fails, check https://www.githubstatus.com.

# error.templateSourceChecksumMismatch

The %s starter source didn't match its expected checksum (expected %s, got %s).

# error.templateSourceChecksumMismatch.actions

- Run the command again; if it still fails, this plugin's pinned reference commit may need updating.

# error.templateSourceMalformed

The %s starter source download is invalid: %s.

# error.templateSourceMalformed.actions

- Run the command again; if it still fails, this plugin's pinned reference commit may need updating.

# error.invalidSignal

The telemetry signal "%s" isn't valid. Use a comma-separated list drawn from: %s.

# error.invalidSignal.actions

- Pass one or more of traces, metrics, logs (comma-separated), or "all" on its own for every signal.

# error.invalidTransport

The telemetry transport "%s" isn't valid. Use one of: %s.

# error.invalidTransport.actions

- Pass one of: %s. http is OTLP over HTTP; grpc is OTLP over gRPC.

# error.invalidHeader

The telemetry header "%s" isn't valid. Headers must be passed as key=value.

# error.invalidHeader.actions

- Pass each header as --header key=value; repeat the flag for more than one header.

# error.telemetryDrainNotFound

Heroku didn't find a telemetry drain with ID %s.

# error.telemetryDrainNotFound.actions

- Confirm the telemetry drain ID is correct; it may have already been removed.
