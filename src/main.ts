import * as core from '@actions/core'

async function run(): Promise<void> {
  try {
    const role_arn: string = core.getInput('role_arn')
    const image: string = core.getInput("image")
    core.debug(`Using ${role_arn} to authenticate to AWS`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true
    core.debug(`Using ${image} as the container image for running the task`)
   
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
