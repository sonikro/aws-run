import { Environment, ExecutionResult, RemoteEnvironment } from "../provider/RemoteEnvironment";
import { UseCase } from "./UseCase";

export interface RunCodeInRemoteEnvironmentDependencies {
    remoteEnvironment: RemoteEnvironment;
}

export interface RunCodeInRemoteEnvironmentInput<SetupSettings> {
    run: string;
    image: string;
    setupSettings: SetupSettings;
}

export interface RunCodeInRemoteEnvironmentOutput {
    executionResult: ExecutionResult
}

export class RunCodeInRemoteEnvironment<SetupSettings> implements UseCase<RunCodeInRemoteEnvironmentInput<SetupSettings>, RunCodeInRemoteEnvironmentOutput> {

    constructor(private readonly dependencies: RunCodeInRemoteEnvironmentDependencies) { }

    async run(input: RunCodeInRemoteEnvironmentInput<SetupSettings>): Promise<RunCodeInRemoteEnvironmentOutput> {

        const { remoteEnvironment } = this.dependencies;
        const { image, run, setupSettings } = input;
        let environment: Environment<any> | undefined

        try {

            environment = await remoteEnvironment.setup({ settings: setupSettings });
            const result = await remoteEnvironment.execute({ environment, image, run });

            return { executionResult: result }
        } catch (error) {
            throw error
        } finally {
            if (environment) {
                await remoteEnvironment.tearDown({ environment })
            }
        }

    }



}