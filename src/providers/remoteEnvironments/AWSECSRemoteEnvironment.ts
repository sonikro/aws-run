import { Credentials } from "aws-sdk";
import { Environment, ExecutionResult, RemoteEnvironment } from "../../core/provider/RemoteEnvironment";
import { STS } from "aws-sdk"

export interface AWSCredentials {
    roleArn: string;
    idToken: string;
}


export interface AWSECSRemoteEnvironmentDependencies {
    sts: STS
}

export class AWSECSRemoteEnvironment implements RemoteEnvironment<STS.Credentials, AWSCredentials, any> {

    constructor(private readonly dependencies: AWSECSRemoteEnvironmentDependencies) { }

    async authenticate(credentials: AWSCredentials): Promise<STS.Credentials> {
        const { sts } = this.dependencies;

        const response = await sts.assumeRoleWithWebIdentity({
            WebIdentityToken: credentials.idToken,
            RoleArn: credentials.roleArn,
            RoleSessionName: "GithubActions-aws-run"
        }).promise()

        return response.Credentials!
    }

    async setup(authSession: STS.Credentials): Promise<Environment<any>> {
        throw new Error('Not supported')

    }

    async execute(args: { environment: Environment<any>, image: string, run: string }): Promise<ExecutionResult> {
        throw new Error('Not supported')

    }
    async tearDown(authSession: STS.Credentials): Promise<void> {
        throw new Error('Not supported')

    }


}