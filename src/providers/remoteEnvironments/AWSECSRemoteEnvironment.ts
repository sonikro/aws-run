import { ECS, STS } from "aws-sdk";
import { Environment, ExecutionResult, RemoteEnvironment } from "../../core/provider/RemoteEnvironment";

export interface AWSCredentials {
    roleArn: string;
    idToken: string;
}

export interface AWSECSRemoteEnvironmentDependencies {
    ecs: ECS
}

export interface AWSECSRemoteEnvironmentSetupSettings {
    vpcId: string;
    subnetId: string;
    uniqueExecutionId: string;
}

export type AWSECSEnvironmentData = ECS.Cluster & AWSECSRemoteEnvironmentSetupSettings
export class AWSECSRemoteEnvironment implements RemoteEnvironment<AWSECSEnvironmentData, AWSECSRemoteEnvironmentSetupSettings> {

    static readonly CLUSTER_NAME = "github-actions-aws-run"

    static async fromGithubOidc({ region, webIdentityToken, roleArn }: { region: string, webIdentityToken: string, roleArn: string }) {

        const sts = new STS({ region })

        const { Credentials } = await sts.assumeRoleWithWebIdentity({
            WebIdentityToken: webIdentityToken,
            RoleArn: roleArn,
            RoleSessionName: "GithubActions",
            DurationSeconds: 3600,
        }).promise()

        const ecs = new ECS({
            region, credentials: {
                accessKeyId: Credentials!.AccessKeyId,
                secretAccessKey: Credentials!.SecretAccessKey,
                sessionToken: Credentials!.SessionToken,
            }
        })

        return new AWSECSRemoteEnvironment({ ecs })
    }

    private constructor(private readonly dependencies: AWSECSRemoteEnvironmentDependencies) { }


    async setup({ settings }: { settings: AWSECSRemoteEnvironmentSetupSettings }): Promise<Environment<AWSECSEnvironmentData>> {

        const ecsCluster = await this.getOrCreateCluster()

        return {
            data: {
                ...ecsCluster,
                ...settings
            }
        }
    }

    async execute({ environment, image, run }: { environment: Environment<AWSECSEnvironmentData>, image: string, run: string }): Promise<ExecutionResult> {
        const { ecs } = this.dependencies

        const taskDefinition = await ecs.registerTaskDefinition({
            containerDefinitions: [{
                image,
                command: [run],
            }],
            family: environment.data.uniqueExecutionId
        }).promise()

        await ecs.runTask({
            cluster: environment.data.clusterArn,
            launchType: "FARGATE",
            startedBy: "github-actions",
            networkConfiguration: {
                awsvpcConfiguration: {
                    assignPublicIp: "DISABLED",
                    subnets: [environment.data.subnetId],
                }
            },
            taskDefinition: taskDefinition.taskDefinition!.family!
        }).promise()

    }

    async tearDown({ environment }: { environment: Environment<AWSECSEnvironmentData> }): Promise<void> {
        const { ecs } = this.dependencies

        try {
            await ecs.deregisterTaskDefinition({ taskDefinition: `${environment.data.uniqueExecutionId}:1` }).promise()
        } catch (error) {
            if (error instanceof Error) {
                console.log(`Error tearing down. ${error.message}`)
            }
        }
    }

    private async getOrCreateCluster(): Promise<ECS.Cluster> {
        const { ecs } = this.dependencies

        const existingClusterResponse = await ecs.describeClusters({
            clusters: [AWSECSRemoteEnvironment.CLUSTER_NAME]
        }).promise()

        if (existingClusterResponse.clusters?.length === 1) {
            return existingClusterResponse.clusters[0]
        }

        const newClusterResponse = await ecs.createCluster({
            capacityProviders: ["FARGATE"],
            clusterName: AWSECSRemoteEnvironment.CLUSTER_NAME,
            tags: [{ key: "managedBy", value: "aws-run" }],
        }).promise()

        return newClusterResponse.cluster!

    }


}