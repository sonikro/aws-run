import {CloudWatchLogs, ECS, S3, STS} from 'aws-sdk'
import {
  Environment,
  ExecutionResult,
  RemoteEnvironment
} from '../../core/provider/RemoteEnvironment'
import {ContainerDefinition} from 'aws-sdk/clients/ecs'
import {readdir} from 'fs/promises'
import path from 'path'
import {createReadStream} from 'fs'

export interface AWSCredentials {
  roleArn: string
  idToken: string
}

export interface AWSECSRemoteEnvironmentDependencies {
  ecs: ECS
  cloudwatchLogs: CloudWatchLogs
  s3: S3
}

export interface AWSECSRemoteEnvironmentSetupSettings {
  vpcId: string
  subnetId: string
  uniqueExecutionId: string
  executionRoleArn: string
  taskRoleArn: string
  s3AccessRoelArn: string
  shell: string
  securityGroupId: string
}

export interface AWSECSEnvironmentData
  extends ECS.Cluster,
    AWSECSRemoteEnvironmentSetupSettings {
  workspaceS3Bucket: string
}
export class AWSECSRemoteEnvironment
  implements
    RemoteEnvironment<
      AWSECSEnvironmentData,
      AWSECSRemoteEnvironmentSetupSettings
    >
{
  static readonly CLUSTER_NAME = 'github-actions-aws-run'

  static async fromGithubOidc({
    region,
    webIdentityToken,
    roleArn
  }: {
    region: string
    webIdentityToken: string
    roleArn: string
  }): Promise<AWSECSRemoteEnvironment> {
    const sts = new STS({region})

    const {Credentials} = await sts
      .assumeRoleWithWebIdentity({
        WebIdentityToken: webIdentityToken,
        RoleArn: roleArn,
        RoleSessionName: 'GithubActions',
        DurationSeconds: 3600
      })
      .promise()

    const credentials = {
      accessKeyId: Credentials!.AccessKeyId,
      secretAccessKey: Credentials!.SecretAccessKey,
      sessionToken: Credentials!.SessionToken
    }

    const ecs = new ECS({
      region,
      credentials
    })

    const s3 = new S3({
      region,
      credentials
    })

    const cloudwatchLogs = new CloudWatchLogs({
      region,
      credentials
    })

    return new AWSECSRemoteEnvironment({ecs, cloudwatchLogs, s3})
  }

  private constructor(
    private readonly dependencies: AWSECSRemoteEnvironmentDependencies
  ) {}

  async setup({
    settings
  }: {
    settings: AWSECSRemoteEnvironmentSetupSettings
  }): Promise<Environment<AWSECSEnvironmentData>> {
    const ecsCluster = await this.getOrCreateCluster()

    const bucketWithWorkspace = await this.uploadWorkspaceToS3(
      `aws-run-${settings.uniqueExecutionId}-workspace`,
      settings.s3AccessRoelArn
    )

    return {
      data: {
        ...ecsCluster,
        ...settings,
        workspaceS3Bucket: bucketWithWorkspace
      }
    }
  }

  async execute({
    environment,
    image,
    run
  }: {
    environment: Environment<AWSECSEnvironmentData>
    image: string
    run: string
  }): Promise<ExecutionResult> {
    const {ecs, cloudwatchLogs} = this.dependencies

    const awsLogsParameters = {
      'awslogs-create-group': 'true',
      'awslogs-group': AWSECSRemoteEnvironment.CLUSTER_NAME,
      'awslogs-region': ecs.config.region!,
      'awslogs-stream-prefix': 'aws-run-logs'
    }

    const unifiedCommand = run.split('\n').join(' && ')

    const workspaceVolumeName = 'runner-workspace'
    const workspaceContainerName = 'workspace'
    const workspaceContainerPath = '/workspace'

    const mainContainerDefinition: ContainerDefinition = {
      image,
      essential: true,
      entryPoint: [environment.data.shell, '-c'],
      command: [unifiedCommand],
      workingDirectory: workspaceContainerPath,
      name: environment.data.uniqueExecutionId,
      logConfiguration: {
        logDriver: 'awslogs',
        options: awsLogsParameters
      },
      dependsOn: [
        {
          containerName: workspaceContainerName,
          condition: 'COMPLETE'
        }
      ],
      mountPoints: [
        {
          containerPath: workspaceContainerPath,
          sourceVolume: workspaceVolumeName
        }
      ]
    }

    const workspaceSidecarDefinition: ContainerDefinition = {
      name: workspaceContainerName,
      image: 'amazon/aws-cli:2.13.1',
      essential: false,
      entryPoint: ['bash', '-c'],
      command: [`aws s3 sync s3://${environment.data.workspaceS3Bucket} .`],
      workingDirectory: workspaceContainerPath,
      mountPoints: [
        {
          containerPath: workspaceContainerPath,
          sourceVolume: workspaceVolumeName
        }
      ],
      logConfiguration: {
        logDriver: 'awslogs',
        options: awsLogsParameters
      }
    }

    const taskDefinition = await ecs
      .registerTaskDefinition({
        family: environment.data.uniqueExecutionId,
        requiresCompatibilities: ['FARGATE'],
        networkMode: 'awsvpc',
        cpu: '256',
        memory: '512',
        executionRoleArn: environment.data.executionRoleArn,
        taskRoleArn: environment.data.taskRoleArn,
        volumes: [
          {
            name: workspaceVolumeName,
            host: {} // transient
          }
        ],
        containerDefinitions: [
          mainContainerDefinition,
          workspaceSidecarDefinition
        ]
      })
      .promise()

    const task = await ecs
      .runTask({
        cluster: environment.data.clusterArn,
        launchType: 'FARGATE',
        startedBy: 'github-actions',
        networkConfiguration: {
          awsvpcConfiguration: {
            assignPublicIp: 'ENABLED',
            subnets: [environment.data.subnetId],
            securityGroups: [environment.data.securityGroupId]
          }
        },
        taskDefinition: taskDefinition.taskDefinition!.family!
      })
      .promise()

    const executionTask = task.tasks![0]!

    console.log(`Remote Task triggered`)

    // Wait for task to stop
    const taskArn = executionTask.taskArn!

    const taskResult = await ecs
      .waitFor('tasksStopped', {
        tasks: [taskArn],
        cluster: environment.data.clusterArn
      })
      .promise()

    console.log(`Task reached stopped status`)

    const taskId = taskArn.split(
      `:task/${AWSECSRemoteEnvironment.CLUSTER_NAME}/`
    )[1]

    const logstreamName = `${awsLogsParameters['awslogs-stream-prefix']}/${environment.data.uniqueExecutionId}/${taskId}`
    const logs = await cloudwatchLogs
      .getLogEvents({
        logStreamName: logstreamName,
        logGroupName: awsLogsParameters['awslogs-group']
      })
      .promise()

    const exitCode = taskResult.tasks![0].containers![0].exitCode!

    return {exitCode, output: logs.events!.map(it => it.message!)}
  }

  async uploadWorkspaceToS3(
    bucketName: string,
    accessRoleArn: string
  ): Promise<string> {
    const {s3} = this.dependencies

    await s3
      .createBucket({
        Bucket: bucketName,
        ACL: 'private'
      })
      .promise()

    await s3
      .putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                AWS: accessRoleArn
              },
              Action: 's3:*',
              Resource: `arn:aws:s3:::${bucketName}/*`
            }
          ]
        })
      })
      .promise()

    const runnerWorkspaceFolder = process.env.GITHUB_WORKSPACE as string

    await this.uploadDir(runnerWorkspaceFolder, bucketName)

    return bucketName
  }

  private async uploadDir(s3Path: string, bucketName: string): Promise<void> {
    const {s3} = this.dependencies

    // Recursive getFiles from
    // https://stackoverflow.com/a/45130990/831465
    async function getFiles(dir: string): Promise<string | string[]> {
      const dirents = await readdir(dir, {withFileTypes: true})
      const files = await Promise.all(
        dirents.map(async dirent => {
          const res = path.resolve(dir, dirent.name)
          return dirent.isDirectory() ? getFiles(res) : res
        })
      )
      return Array.prototype.concat(...files)
    }

    const files = (await getFiles(s3Path)) as string[]
    const uploads = files.map(async filePath =>
      s3
        .putObject({
          Key: path.relative(s3Path, filePath),
          Bucket: bucketName,
          Body: createReadStream(filePath)
        })
        .promise()
    )
    await Promise.all(uploads)
  }

  async tearDown({
    environment
  }: {
    environment: Environment<AWSECSEnvironmentData>
  }): Promise<void> {
    const {ecs} = this.dependencies

    try {
      await this.deleteBucket(environment.data.workspaceS3Bucket)
      await ecs
        .deregisterTaskDefinition({
          taskDefinition: `${environment.data.uniqueExecutionId}:1`
        })
        .promise()
    } catch (error) {
      if (error instanceof Error) {
        console.log(`Error tearing down. ${error.message}`)
      }
    }
  }

  private async deleteBucket(bucketName: string): Promise<void> {
    const {s3} = this.dependencies

    const allObjects = await s3.listObjectsV2({Bucket: bucketName}).promise()

    await Promise.all(
      allObjects.Contents!.map(async content =>
        s3.deleteObject({Bucket: bucketName, Key: content.Key!}).promise()
      )
    )

    await s3.deleteBucket({Bucket: bucketName}).promise()
  }

  private async getOrCreateCluster(): Promise<ECS.Cluster> {
    const {ecs} = this.dependencies

    const existingClusterResponse = await ecs
      .describeClusters({
        clusters: [AWSECSRemoteEnvironment.CLUSTER_NAME]
      })
      .promise()

    if (existingClusterResponse.clusters?.length === 1) {
      return existingClusterResponse.clusters[0]
    }

    const newClusterResponse = await ecs
      .createCluster({
        capacityProviders: ['FARGATE'],
        clusterName: AWSECSRemoteEnvironment.CLUSTER_NAME,
        tags: [{key: 'managedBy', value: 'aws-run'}]
      })
      .promise()

    return newClusterResponse.cluster!
  }
}
