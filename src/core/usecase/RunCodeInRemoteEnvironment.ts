import {
  ExecutionResult,
  ExecutionSettings,
  RemoteEnvironment
} from '../provider/RemoteEnvironment'
import {UseCase} from './UseCase'

export interface RunCodeInRemoteEnvironmentDependencies {
  remoteEnvironment: RemoteEnvironment
}

export interface RunCodeInRemoteEnvironmentOutput {
  executionResult: ExecutionResult
}

export class RunCodeInRemoteEnvironment
  implements UseCase<ExecutionSettings, ExecutionResult>
{
  constructor(
    private readonly dependencies: RunCodeInRemoteEnvironmentDependencies
  ) {}

  async run<T extends ExecutionSettings>(
    settings: T
  ): Promise<ExecutionResult> {
    const {remoteEnvironment} = this.dependencies

    let result: ExecutionResult | undefined
    try {
      result = await remoteEnvironment.execute({settings})
      return result
    } catch (error) {
      throw error
    } finally {
      if (result) {
        await remoteEnvironment.tearDown()
      }
    }
  }
}
