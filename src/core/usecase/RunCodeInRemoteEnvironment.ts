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

    try {
      return await remoteEnvironment.execute({settings})
    } catch (error) {
      throw error
    } finally {
      await remoteEnvironment.tearDown()
    }
  }
}
