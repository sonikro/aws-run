import * as core from '@actions/core'
import {RunCodeInRemoteEnvironment} from './core/usecase/RunCodeInRemoteEnvironment'
import {AWSECSRemoteEnvironment} from './providers/remoteEnvironments/AWSECSRemoteEnvironment'
import {v4 as uuidv4} from 'uuid'
import {ECSExecutionSettings} from './providers/remoteEnvironments/ECSExecutionSettings'
import {STATE_SETTINGS_UNIQUE_NAME} from './constants'
import dotenv from 'dotenv'
import {Tags} from './providers/awsServices/SharedTypes'

async function run(): Promise<void> {
  try {
    dotenv.config()
    const prefix: string = 'INPUT'
    const roleArn: string = getInput(prefix, 'role_arn', {
      required: false
    })
    const taskRoleArn: string = getInput(prefix, 'task_role_arn', {
      required: false
    })
    const executionRoleArn: string = getInput(prefix, 'execution_role_arn', {
      required: false
    })
    if (!hasValidRoleConfig(roleArn, taskRoleArn, executionRoleArn)) {
      throw new Error(
        'Error - Must specify either ROLE_ARN, or both TASK_ROLE_ARN and EXECUTION_ROLE_ARN'
      )
    }
    const tagsStringArray: string[] = getInput(prefix, 'tags')
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const tags: Tags = {}
    tagsStringArray.forEach(tag => {
      const [key, value] = tag.split('=')
      tags[key] = value
    })
    const image: string = getInput(prefix, 'image')
    const region: string = getInput(prefix, 'region')
    const runScript: string = getInput(prefix, 'run')
    const vpcId: string = getInput(prefix, 'vpc_id')
    const subnetIds: string[] = getInput(prefix, 'subnet_ids', {
      required: false
    })
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const uploadIncludes: string[] = getInput(prefix, 'upload_includes', {
      required: false
    })
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const uploadExcludes: string[] = getInput(prefix, 'upload_excludes', {
      required: false
    })
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const downloadIncludes: string[] = getInput(prefix, 'download_includes', {
      required: false
    })
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const downloadExcludes: string[] = getInput(prefix, 'download_excludes', {
      required: false
    })
      .split('\n')
      .map(s => s.trim())
      .filter(x => x !== '')
    const shell: string = getInput(prefix, 'shell')
    const securityGroupId: string = getInput(prefix, 'security_group_id', {
      required: false
    })
    const memory: string = getInput(prefix, `memory`)
    const cpu: string = getInput(prefix, `cpu`)
    const ecsClusterName: string = getInput(prefix, `ecs_cluster_name`)
    const pollingInterval = Number(getInput(prefix, `polling_interval`))
    const postCompleteLogCycles = Number(
      getInput(prefix, `post_complete_log_cycles`)
    )

    core.debug(`Using ${roleArn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${image} as the container image for running the task`)
    core.debug(`Using ${region} as the AWS Region for operations`)

    const awsRemoteEnvironment = process.env.GITHUB_ACTION
      ? await AWSECSRemoteEnvironment.fromGithubOidc({
          region,
          roleArn,
          webIdentityToken: await core.getIDToken('sts.amazonaws.com')
        })
      : await AWSECSRemoteEnvironment.fromDefault({
          region
        })

    const runInRemoteEnvironment = new RunCodeInRemoteEnvironment({
      remoteEnvironment: awsRemoteEnvironment
    })

    const uniqueExecutionId = `aws-run-${uuidv4()}`
    core.debug(`Using ${uniqueExecutionId} as uniqueExecutionid`)

    const settings: ECSExecutionSettings = {
      image,
      run: runScript,
      vpcId,
      subnetIds,
      uniqueExecutionId,
      executionRoleArn: executionRoleArn !== '' ? executionRoleArn : roleArn,
      taskRoleArn: taskRoleArn !== '' ? taskRoleArn : roleArn,
      shell,
      securityGroupId,
      memory,
      cpu,
      ecsClusterName,
      runnerWorkspaceFolder: process.env.GITHUB_WORKSPACE as string,
      tags,
      pollingInterval,
      postCompleteLogCycles,
      downloadExcludes,
      downloadIncludes,
      uploadExcludes,
      uploadIncludes
    }

    core.saveState(STATE_SETTINGS_UNIQUE_NAME, settings)

    const executionResult =
      await runInRemoteEnvironment.run<ECSExecutionSettings>({
        settings,
        tearDown: shouldCleanup()
      })

    if (executionResult.exitCode !== 0) {
      core.setFailed(`Remote execution failed. Check the logs`)
    }
  } catch (error: any) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      console.log(error.stack)
    } else {
      core.setFailed('Failed to run aws-run action')
    }
    core.debug(JSON.stringify(error))
  }
}

function hasValidRoleConfig(
  roleArn: string,
  taskRole: string,
  execRole: string
): boolean {
  if (roleArn) {
    return true
  } else if (taskRole && execRole) {
    return true
  }
  return false
}

function shouldCleanup(): boolean {
  const skipCleanup: boolean = [process.env.SKIP_CLEANUP].some(x => {
    return x !== undefined
  })
  const cleanupAllowed: boolean = process.env.GITHUB_ACTION === undefined
  return cleanupAllowed && !skipCleanup
}

export function getInput(
  prefix: string,
  name: string,
  options?: core.InputOptions
): string {
  const val: string =
    process.env[`${prefix}_${name.replace(/ /g, '_').toUpperCase()}`] || ''
  if (options && options.required && !val) {
    throw new Error(`Input required and not supplied: ${name}`)
  }

  if (options && options.trimWhitespace === false) {
    return val
  }

  return val.trim()
}

run()
