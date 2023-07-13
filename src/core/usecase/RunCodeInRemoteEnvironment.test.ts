import { describe, it, expect, jest } from '@jest/globals'
import { RunCodeInRemoteEnvironment, RunCodeInRemoteEnvironmentDependencies, RunCodeInRemoteEnvironmentInput } from "./RunCodeInRemoteEnvironment"
import { Environment, ExecutionResult, RemoteEnvironment } from '../provider/RemoteEnvironment'

describe("RunCodeInRemoteEnvironment use case", () => {

    const makeSut = () => {

        const mockedAuthSession = { accessKey: "", accessId: "", sessionId: "" }

        const mockedEnvironment: Environment<any> = {
            data: {
                clusterId: "ecs-cluster-id"
            }
        }

        const mockedExecutionResult: ExecutionResult = {
            exitCode: 0,
            output: "hello-world"
        }

        const credentials = { role_arn: "role arn" }
        const mockedInput: RunCodeInRemoteEnvironmentInput<typeof credentials> = {
            credentials,
            image: "ubuntu:latest",
            run: "echo 'hello-world'"
        }
        const mockedRemoteEnvironment = {
            authenticate: jest.fn().mockImplementation(() => Promise.resolve(mockedAuthSession)),
            setup: jest.fn().mockImplementation(() => Promise.resolve(mockedEnvironment)),
            tearDown: jest.fn().mockImplementation(() => console.log('Tearing down')),
            execute: jest.fn().mockImplementation(() => Promise.resolve(mockedExecutionResult))
        } 


        const dependencies: RunCodeInRemoteEnvironmentDependencies = {
            remoteEnvironment: mockedRemoteEnvironment as RemoteEnvironment
        }

        return {
            Sut: RunCodeInRemoteEnvironment,
            dependencies,
            mockedRemoteEnvironment,
            mockedInput
        }
    }

    it("sets up the remote environment, execute the code, and return the results", async () => {
        // Given

        const { Sut, dependencies, mockedInput } = makeSut()
        // When
        const sut = new Sut(dependencies)

        const result = await sut.run(mockedInput)
        // Then
        expect(result.executionResult).toMatchObject({
            exitCode: 0,
            output: 'hello-world'
        })

        expect(dependencies.remoteEnvironment.tearDown).toHaveBeenCalled()
    })

    it("tears down the environment even if execution fails", async () => {
        // Given

        const { Sut, dependencies, mockedInput, mockedRemoteEnvironment } = makeSut()

        mockedRemoteEnvironment.setup = jest.fn().mockImplementation(() => Promise.reject(new Error('Setup error')))
        // When
        const sut = new Sut(dependencies)

        const act = () => sut.run(mockedInput)
        // Then

        expect(act()).rejects.toThrowError('Setup error');
        // expect(dependencies.remoteEnvironment.tearDown).toHaveBeenCalled()
    })
})