import * as core from '@actions/core'
import { RunCodeInRemoteEnvironment } from './core/usecase/RunCodeInRemoteEnvironment'
import { AWSCredentials, AWSECSRemoteEnvironment } from './providers/remoteEnvironments/AWSECSRemoteEnvironment'
import { STS } from "aws-sdk"


async function run(): Promise<void> {
  try {
    const roleArn: string = core.getInput('role_arn')
    const image: string = core.getInput("image")
    const region: string = core.getInput("region")
    const run: string = core.getInput("run")

    core.debug(`Using ${roleArn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${image} as the container image for running the task`)
    core.debug(`Using ${region} as the AWS Region for operations`)

    const webIdentityToken = await core.getIDToken("sts.amazonaws.com");

    const awsRemoteEnvironment = new AWSECSRemoteEnvironment({
      sts: new STS({ region })
    })
    const runInRemoteEnvironment = new RunCodeInRemoteEnvironment<AWSCredentials>({
      remoteEnvironment: awsRemoteEnvironment
    })

    await runInRemoteEnvironment.run({
      image,
      run,
      credentials: {
        idToken: webIdentityToken,
        roleArn
      }
    })

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.debug(JSON.stringify(error))
  }
}

run()
