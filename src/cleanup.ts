import * as core from '@actions/core'
import {STATE_SETTINGS_UNIQUE_NAME} from './constants'
import {AWSECSTeardownEnvironment} from './providers/remoteEnvironments/AWSECSTeardownEnvironment'
import {ECSExecutionSettings} from './providers/remoteEnvironments/ECSExecutionSettings'
/**
 * When the Action is done, Cleanup all of the generated AWS Resources
 */
export async function cleanup(): Promise<void> {
  try {
    const settings: ECSExecutionSettings = JSON.parse(
      core.getState(STATE_SETTINGS_UNIQUE_NAME)
    )

    const roleArn: string = core.getInput('role_arn')
    const region: string = core.getInput('region')

    core.debug(`Using ${roleArn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${region} as the AWS Region for operations`)

    const webIdentityToken = await core.getIDToken('sts.amazonaws.com')

    core.info(
      `Cleaning up resources for executionId: ${settings.uniqueExecutionId}`
    )

    const ecsTeardownEnvironment =
      await AWSECSTeardownEnvironment.fromGithubOidc({
        roleArn,
        region,
        webIdentityToken
      })

    await ecsTeardownEnvironment.tearDown({settings})
    core.info(`Cleanup complete for execution ID ${settings.uniqueExecutionId}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

cleanup()
