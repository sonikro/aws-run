import { ExecutionResult, RemoteEnvironment } from "../provider/RemoteEnvironment";
import { UseCase } from "./UseCase";

export interface RunCodeInRemoteEnvironmentDependencies {
    remoteEnvironment: RemoteEnvironment;
}

export interface RunCodeInRemoteEnvironmentInput<Credentials> {
    run: string;
    image: string;
    credentials: Credentials;
}

export interface RunCodeInRemoteEnvironmentOutput {
    executionResult: ExecutionResult
}

export class RunCodeInRemoteEnvironment<Credentials> implements UseCase<RunCodeInRemoteEnvironmentInput<Credentials>, RunCodeInRemoteEnvironmentOutput> {

    constructor(private readonly dependencies: RunCodeInRemoteEnvironmentDependencies) { }

    async run(input: RunCodeInRemoteEnvironmentInput<Credentials>): Promise<RunCodeInRemoteEnvironmentOutput> {

        const { remoteEnvironment } = this.dependencies;
        const { credentials, image, run } = input;
        const authSession = await remoteEnvironment.authenticate(credentials)

        try {

            const environment = await remoteEnvironment.setup(authSession);
            const result = await remoteEnvironment.execute({ environment, image, run });

            return { executionResult: result }
        } catch (error) {
            throw error
        } finally {
            await remoteEnvironment.tearDown(authSession)
        }

    }



}