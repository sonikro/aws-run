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

export interface RunCodeInRemoteEnvironmentInput<Settings> {
  settings: Settings
  tearDown: boolean
}

export class RunCodeInRemoteEnvironment
  implements UseCase<RunCodeInRemoteEnvironmentInput<unknown>, ExecutionResult>
{
  constructor(
    private readonly dependencies: RunCodeInRemoteEnvironmentDependencies
  ) {}

  async run<T extends ExecutionSettings>({
    settings,
    tearDown
  }: {
    settings: T
    tearDown: boolean
  }): Promise<ExecutionResult> {
    const {remoteEnvironment} = this.dependencies

    try {
      return await remoteEnvironment.execute({settings})
    } catch (error) {
      throw error
    } finally {
      if (tearDown) {
        await remoteEnvironment.tearDown({settings})
      }
    }
  }
}
