import {
  ExecutionResult,
  ExecutionSettings,
  RemoteEnvironment
} from '../provider/RemoteEnvironment'
import {
  RunCodeInRemoteEnvironment,
  RunCodeInRemoteEnvironmentDependencies
} from './RunCodeInRemoteEnvironment'

describe('RunCodeInRemoteEnvironment', () => {
  const makeSut = () => {
    const mockExecutionResult: ExecutionResult = {
      exitCode: 0
    }
    const remoteEnvironment: RemoteEnvironment = {
      execute: jest.fn().mockResolvedValue(mockExecutionResult),
      tearDown: jest.fn()
    }
    const dependencies: RunCodeInRemoteEnvironmentDependencies = {
      remoteEnvironment
    }

    const executionSettings: ExecutionSettings = {
      image: 'terraform:latest',
      run: 'terraform apply',
      shell: 'sh'
    }
    return {
      Sut: RunCodeInRemoteEnvironment,
      dependencies,
      remoteEnvironment,
      executionSettings,
      mockExecutionResult
    }
  }
  it('returns the remoteEnvironment execution result', async () => {
    // Given
    const {
      Sut,
      dependencies,
      executionSettings,
      mockExecutionResult: expectedExecutionResult
    } = makeSut()
    // When
    const runCodeInRemote = new Sut(dependencies)
    const receivedResult = await runCodeInRemote.run(executionSettings)
    // Then
    expect(receivedResult).toEqual(expectedExecutionResult)
  })

  it('throws an error if remote execution fails', async () => {
    // Given
    const {Sut, dependencies, executionSettings} = makeSut()
    const expectedError = new Error('Error during remote execution')
    dependencies.remoteEnvironment.execute = jest
      .fn()
      .mockRejectedValue(expectedError)
    // When
    const runCodeInRemote = new Sut(dependencies)
    const act = () => runCodeInRemote.run(executionSettings)

    // Then
    await expect(act()).rejects.toThrowError(expectedError)
  })

  it('tears down the remoteEnvironment if execution is successfull', async () => {
    // Given
    const {
      Sut,
      dependencies,
      executionSettings,
      mockExecutionResult: expectedExecutionResult
    } = makeSut()
    // When
    const runCodeInRemote = new Sut(dependencies)
    const receivedResult = await runCodeInRemote.run(executionSettings)
    // Then
    expect(receivedResult).toEqual(expectedExecutionResult)
    expect(dependencies.remoteEnvironment.tearDown).toHaveBeenCalled()
  })

  it('tears down the remote environment if execution failed', async () => {
    // Given
    const {Sut, dependencies, executionSettings} = makeSut()
    const expectedError = new Error('Error during remote execution')
    dependencies.remoteEnvironment.execute = jest
      .fn()
      .mockRejectedValue(expectedError)
    // When
    const runCodeInRemote = new Sut(dependencies)
    const act = () => runCodeInRemote.run(executionSettings)

    // Then
    await expect(act()).rejects.toThrowError(expectedError)
    expect(dependencies.remoteEnvironment.tearDown).toHaveBeenCalled()
  })
})
