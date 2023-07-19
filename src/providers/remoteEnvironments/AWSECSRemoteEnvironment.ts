import {CloudWatchLogs, ECS, S3, STS} from 'aws-sdk'
import {ContainerDefinition} from 'aws-sdk/clients/ecs'
import {createReadStream} from 'fs'
import {readdir} from 'fs/promises'
import path from 'path'
import {
  ExecutionResult,
  ExecutionSettings,
  RemoteEnvironment
} from '../../core/provider/RemoteEnvironment'
import * as core from '@actions/core'

export interface AWSCredentials {
  roleArn: string
  idToken: string
}

export interface AWSECSRemoteEnvironmentDependencies {
  ecs: ECS
  cloudwatchLogs: CloudWatchLogs
  s3: S3
}

export interface ECSExecutionSettings extends ExecutionSettings {
  vpcId: string
  subnetIds: string[]
  uniqueExecutionId: string
  executionRoleArn: string
  taskRoleArn: string
  shell: string
  securityGroupId: string
  memory: string
  cpu: string
  ecsClusterName: string
  runnerWorkspaceFolder: string
}

export interface ECSTaskExecutionResult extends ExecutionResult {
  ecsCluster: ECS.Cluster
  ecsTask: ECS.Task
  ecsTaskDefinition: ECS.TaskDefinition
  s3WorkspaceBucket: string
}

export type TeardownFunction = () => Promise<any>
export class AWSECSRemoteEnvironment
  implements RemoteEnvironment<ECSExecutionSettings>
{
  private readonly tearDownQueue: TeardownFunction[] = []

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

  /**
   * Execute script in remote ECS Task environment
   */
  async execute({
    settings
  }: {
    settings: ECSExecutionSettings
  }): Promise<ECSTaskExecutionResult> {
    const {ecs} = this.dependencies

    // Setup Environment
    console.log('Setting up required infrastructure')
    const ecsCluster = await this.setupECSCluster({settings})
    console.log(`Using ECS Cluster ${ecsCluster.clusterName}`)
    core.debug(
      `Uploading runner workspace to S3 so it can be shared with the remote execution ECS Task`
    )
    const s3Workspace = await this.setupS3Workspace({settings})
    core.debug(`Workspace uploaded successfully`)
    core.debug(`Creating task definition`)
    const taskDefinition = await this.createTaskDefinition({
      settings,
      s3Workspace
    })
    console.log(`Starting ECS Task`)
    // Start Remote Execution
    const executionTask = await this.startTask({
      ecsCluster,
      settings,
      taskDefinition
    })
    console.log(`Waiting until ECS Task is running`)
    await ecs
      .waitFor('tasksRunning', {
        tasks: [executionTask.taskArn!],
        cluster: ecsCluster.clusterArn
      })
      .promise()

    core.debug(`Streaming Cloudwatch Logs until task reaches STOPPED state`)
    // Listen for logs until task reaches stopped status
    const stoppedTask = await this.streamLogsUntilStopped({
      taskArn: executionTask.taskArn!,
      taskDefinition,
      settings,
      cluster: ecsCluster
    })
    console.log(`ECS Task execution completed`)
    // Wait for task to stop

    const mainContainer = stoppedTask.containers!.find(
      it => it.name === settings.uniqueExecutionId
    )!

    const exitCode = mainContainer.exitCode!

    return {
      exitCode,
      ecsCluster,
      ecsTask: stoppedTask,
      ecsTaskDefinition: taskDefinition,
      s3WorkspaceBucket: s3Workspace
    }
  }

  protected async setupECSCluster({
    settings
  }: {
    settings: ECSExecutionSettings
  }): Promise<ECS.Cluster> {
    const ecsCluster = await this.getOrCreateCluster({settings})
    return ecsCluster
  }

  protected async setupS3Workspace({
    settings
  }: {
    settings: ECSExecutionSettings
  }): Promise<string> {
    const bucketWithWorkspace = await this.uploadWorkspaceToS3(
      `aws-run-${settings.uniqueExecutionId}-workspace`,
      settings.taskRoleArn,
      settings.runnerWorkspaceFolder
    )

    return bucketWithWorkspace
  }

  protected async createTaskDefinition({
    settings,
    s3Workspace
  }: {
    settings: ECSExecutionSettings
    s3Workspace: string
  }): Promise<ECS.TaskDefinition> {
    const {ecs} = this.dependencies

    const awsLogsParameters = {
      'awslogs-create-group': 'true',
      'awslogs-group': settings.ecsClusterName,
      'awslogs-region': ecs.config.region!,
      'awslogs-stream-prefix': 'aws-run-logs'
    }

    const unifiedCommand = settings.run.split('\n').join(' && ')

    const workspaceVolumeName = 'runner-workspace'
    const workspaceContainerName = 'workspace'
    const workspaceContainerPath = '/workspace'

    const mainContainerDefinition: ContainerDefinition = {
      image: settings.image,
      essential: true,
      entryPoint: [settings.shell, '-c'],
      command: [unifiedCommand],
      workingDirectory: workspaceContainerPath,
      name: settings.uniqueExecutionId,
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
      command: [`aws s3 sync s3://${s3Workspace} .`],
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
        family: settings.uniqueExecutionId,
        requiresCompatibilities: ['FARGATE'],
        networkMode: 'awsvpc',
        cpu: settings.cpu,
        memory: settings.memory,
        executionRoleArn: settings.executionRoleArn,
        taskRoleArn: settings.taskRoleArn,
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

    this.tearDownQueue.push(
      async () =>
        await ecs
          .deregisterTaskDefinition({
            taskDefinition: `${taskDefinition.taskDefinition!.family!}:1`
          })
          .promise()
    )

    return taskDefinition.taskDefinition!
  }

  protected async startTask({
    taskDefinition,
    ecsCluster,
    settings
  }: {
    taskDefinition: ECS.TaskDefinition
    ecsCluster: ECS.Cluster
    settings: ECSExecutionSettings
  }): Promise<ECS.Task> {
    const {ecs} = this.dependencies
    const task = await ecs
      .runTask({
        cluster: ecsCluster.clusterName,
        launchType: 'FARGATE',
        startedBy: 'github-actions',
        networkConfiguration: {
          awsvpcConfiguration: {
            assignPublicIp: 'ENABLED',
            subnets: settings.subnetIds,
            securityGroups: [settings.securityGroupId]
          }
        },
        taskDefinition: taskDefinition.family!
      })
      .promise()

    return task.tasks![0]!
  }

  protected async streamLogsUntilStopped({
    taskArn,
    taskDefinition,
    settings,
    cluster
  }: {
    cluster: ECS.Cluster
    taskArn: string
    taskDefinition: ECS.TaskDefinition
    settings: ECSExecutionSettings
  }): Promise<ECS.Task> {
    const {cloudwatchLogs, ecs} = this.dependencies

    const taskId = taskArn.split(`:task/${settings.ecsClusterName}/`)[1]

    const POLLING_INTERVAL = 2000

    this.tearDownQueue.push(async () => {
      await Promise.all(
        taskDefinition.containerDefinitions!.map(async it => {
          const logStreamName = `${
            it.logConfiguration!.options!['awslogs-stream-prefix']
          }/${it.name}/${taskId}`
          const logGroupName = it.logConfiguration!.options!['awslogs-group']
          core.debug(`Deleting Logstream ${logGroupName}/${logStreamName}`)
          return await cloudwatchLogs
            .deleteLogStream({
              logGroupName,
              logStreamName
            })
            .promise()
        })
      )
    })

    return await new Promise<ECS.Task>(resolve => {
      let nextToken: string | undefined

      const timer = setInterval(async () => {
        const mainContainerDefinition =
          taskDefinition.containerDefinitions?.find(
            it => (it.name = settings.uniqueExecutionId)
          )!

        const logstreamName = `${
          mainContainerDefinition.logConfiguration!.options![
            'awslogs-stream-prefix'
          ]
        }/${settings.uniqueExecutionId}/${taskId}`
        const logGroup =
          mainContainerDefinition.logConfiguration!.options!['awslogs-group']

        const logs = await cloudwatchLogs
          .getLogEvents({
            logStreamName: logstreamName,
            logGroupName: logGroup,
            startFromHead: true,
            nextToken
          })
          .promise()

        nextToken = logs.nextForwardToken

        logs.events?.map(it => it.message).forEach(log => console.log(log))

        const taskState = await ecs
          .describeTasks({tasks: [taskArn], cluster: cluster.clusterName})
          .promise()

        if (taskState.tasks![0]!.lastStatus === 'STOPPED') {
          resolve(taskState.tasks![0]!)
          clearInterval(timer)
        }
      }, POLLING_INTERVAL)
    })
  }

  protected async uploadWorkspaceToS3(
    bucketName: string,
    accessRoleArn: string,
    runnerWorkspaceFolder: string
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

    await this.uploadDir(runnerWorkspaceFolder, bucketName)

    this.tearDownQueue.push(async () => await this.deleteBucket(bucketName))

    return bucketName
  }

  protected async uploadDir(s3Path: string, bucketName: string): Promise<void> {
    const {s3} = this.dependencies

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

  async tearDown(): Promise<void> {
    await Promise.all(
      this.tearDownQueue.map(async tearDown => await tearDown())
    )
  }

  protected async deleteBucket(bucketName: string): Promise<void> {
    const {s3} = this.dependencies

    core.debug(`Deleting Bucket ${bucketName}`)
    const allObjects = await s3.listObjectsV2({Bucket: bucketName}).promise()

    await Promise.all(
      allObjects.Contents!.map(
        async content =>
          await s3
            .deleteObject({Bucket: bucketName, Key: content.Key!})
            .promise()
      )
    )

    await s3.deleteBucket({Bucket: bucketName}).promise()
  }

  protected async getOrCreateCluster({
    settings
  }: {
    settings: ECSExecutionSettings
  }): Promise<ECS.Cluster> {
    const {ecs} = this.dependencies

    const existingClusterResponse = await ecs
      .describeClusters({
        clusters: [settings.ecsClusterName]
      })
      .promise()

    if (existingClusterResponse.clusters?.length === 1) {
      return existingClusterResponse.clusters[0]
    }

    const newClusterResponse = await ecs
      .createCluster({
        capacityProviders: ['FARGATE'],
        clusterName: settings.ecsClusterName,
        tags: [{key: 'managedBy', value: 'aws-run'}]
      })
      .promise()

    return newClusterResponse.cluster!
  }
}
