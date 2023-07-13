import * as core from '@actions/core'
import { RunCodeInRemoteEnvironment } from './core/usecase/RunCodeInRemoteEnvironment'
import { AWSCredentials, AWSECSRemoteEnvironment } from './providers/remoteEnvironments/AWSECSRemoteEnvironment'
import { STS, ECS } from "aws-sdk"


async function run(): Promise<void> {
  try {
    const roleArn: string = core.getInput('role_arn')
    const image: string = core.getInput("image")
    const region: string = core.getInput("region")
    const run: string = core.getInput("run")
    const vpcId: string = core.getInput("vpc_id");
    const subnetId: string = core.getInput("subnet_id");

    core.debug(`Using ${roleArn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${image} as the container image for running the task`)
    core.debug(`Using ${region} as the AWS Region for operations`)

    const webIdentityToken = await core.getIDToken("sts.amazonaws.com");

    const awsRemoteEnvironment = await AWSECSRemoteEnvironment.fromGithubOidc({
      region,
      roleArn,
      webIdentityToken
    })

    const runInRemoteEnvironment = new RunCodeInRemoteEnvironment({
      remoteEnvironment: awsRemoteEnvironment
    })

    const [owner, repository] = process.env.GITHUB_REPOSITORY!.split("/")

    const uniqueExecutionid = `${owner}-${repository}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_NUMBER}`
    core.debug(`Using ${uniqueExecutionid} as uniqueExecutionid`)

    await runInRemoteEnvironment.run({
      image,
      run,
      settings: {
        vpcId,
        subnetId,
        uniqueExecutionid
      }
    })

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.debug(JSON.stringify(error))
  }
}

run()
