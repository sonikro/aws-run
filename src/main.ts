import * as core from '@actions/core'
import {RunCodeInRemoteEnvironment} from './core/usecase/RunCodeInRemoteEnvironment'
import {
  AWSECSRemoteEnvironment,
  ECSExecutionSettings
} from './providers/remoteEnvironments/AWSECSRemoteEnvironment'

async function run(): Promise<void> {
  try {
    const roleArn: string = core.getInput('role_arn')
    const executionRoleArn: string = core.getInput('execution_role_arn', {
      required: false
    })
    const taskRoleArn: string = core.getInput('task_role_arn', {
      required: false
    })
    const image: string = core.getInput('image')
    const region: string = core.getInput('region')
    const runScript: string = core.getInput('run')
    const vpcId: string = core.getInput('vpc_id')
    const subnetId: string = core.getInput('subnet_id')
    const shell: string = core.getInput('shell')
    const securityGroupId: string = core.getInput('security_group_id')
    const memory: string = core.getInput(`memory`)
    const cpu: string = core.getInput(`cpu`)
    const ecsClusterName: string = core.getInput(`ecs_cluster_name`)

    core.debug(`Using ${roleArn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${image} as the container image for running the task`)
    core.debug(`Using ${region} as the AWS Region for operations`)

    const webIdentityToken = await core.getIDToken('sts.amazonaws.com')

    const awsRemoteEnvironment = await AWSECSRemoteEnvironment.fromGithubOidc({
      region,
      roleArn,
      webIdentityToken
    })

    const runInRemoteEnvironment = new RunCodeInRemoteEnvironment({
      remoteEnvironment: awsRemoteEnvironment
    })

    const [owner, repository] = process.env.GITHUB_REPOSITORY!.split('/')

    const uniqueExecutionId = `${owner}-${repository}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_NUMBER}-${process.env.GITHUB_RUN_ATTEMPT}`
    core.debug(`Using ${uniqueExecutionId} as uniqueExecutionid`)

    const executionResult =
      await runInRemoteEnvironment.run<ECSExecutionSettings>({
        image,
        run: runScript,
        vpcId,
        subnetId,
        uniqueExecutionId,
        executionRoleArn: executionRoleArn !== '' ? executionRoleArn : roleArn,
        taskRoleArn: taskRoleArn !== '' ? taskRoleArn : roleArn,
        shell,
        securityGroupId,
        memory,
        cpu,
        ecsClusterName
      })

    if (executionResult.exitCode !== 0) {
      core.setFailed(`Remote execution failed. Check the logs`)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('Failed to run aws-run action')
    }
    core.debug(JSON.stringify(error))
  }
}

run()
