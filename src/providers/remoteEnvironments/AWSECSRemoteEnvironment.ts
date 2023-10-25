import {S3Client} from '@aws-sdk/client-s3'
import {CloudWatchLogs, EC2, ECS, S3, STS} from 'aws-sdk'
import {S3SyncClient} from 's3-sync-client'
import {Logger} from '../../core/provider/Logger'
import {
  ExecutionResult,
  RemoteEnvironment
} from '../../core/provider/RemoteEnvironment'
import {GHALogger} from '../GHALogger'
import {BucketService} from '../awsServices/BucketService'
import {ContainerService} from '../awsServices/ContainerService'
import {LogStreamingService} from '../awsServices/LogStreamingService'
import {NetworkService} from '../awsServices/NetworkService'
import {Tags} from '../awsServices/SharedTypes'
import {ECSExecutionSettings} from './ECSExecutionSettings'

export interface AWSECSRemoteEnvironmentDependencies {
  logger: Logger
  logStreamingService: LogStreamingService
  networkService: NetworkService
  containerService: ContainerService
  bucketService: BucketService
}

export interface ECSTaskExecutionResult extends ExecutionResult {
  ecsCluster: ECS.Cluster
  ecsTask: ECS.Task
  ecsTaskDefinition: ECS.TaskDefinition
  s3WorkspaceBucket: string
}

export type TeardownFunction = () => Promise<unknown>

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
        RoleSessionName: 'GithubActionsAWSRun',
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

    const ec2 = new EC2({
      region,
      credentials
    })

    const s3Client = new S3Client({
      region,
      credentials
    })

    const logger = new GHALogger()

    const s3SyncClient = new S3SyncClient({client: s3Client})

    const bucketService = new BucketService({logger, s3, s3SyncClient})
    const containerService = new ContainerService({ecs, logger})
    const networkService = new NetworkService({ec2})
    const logStreamingService = new LogStreamingService({
      cloudwatchLogs,
      ecs,
      logger
    })

    return new AWSECSRemoteEnvironment({
      logStreamingService,
      networkService,
      bucketService,
      containerService,
      logger
    })
  }

  static async fromDefault({
    region
  }: {
    region: string
  }): Promise<AWSECSRemoteEnvironment> {
    const ecs = new ECS({
      region
    })

    const s3 = new S3({
      region
    })

    const cloudwatchLogs = new CloudWatchLogs({
      region
    })

    const ec2 = new EC2({
      region
    })

    const s3Client = new S3Client({
      region
    })

    const logger = new GHALogger()

    const s3SyncClient = new S3SyncClient({client: s3Client})

    const bucketService = new BucketService({logger, s3, s3SyncClient})
    const containerService = new ContainerService({ecs, logger})
    const networkService = new NetworkService({ec2})
    const logStreamingService = new LogStreamingService({
      cloudwatchLogs,
      ecs,
      logger
    })

    return new AWSECSRemoteEnvironment({
      logStreamingService,
      networkService,
      bucketService,
      containerService,
      logger
    })
  }

  private constructor(
    private readonly dependencies: AWSECSRemoteEnvironmentDependencies
  ) {}

  async execute({
    settings
  }: {
    settings: ECSExecutionSettings
  }): Promise<ECSTaskExecutionResult> {
    const {
      containerService,
      logger,
      bucketService,
      networkService,
      logStreamingService
    } = this.dependencies

    /// Prepares all of the infrastructure before running the ECS Task

    const tags: Tags = {
      ...settings.tags,
      managedBy: 'aws-run',
      executionId: settings.uniqueExecutionId
    }

    logger.info('Setting up required infrastructure...')

    const ecsCluster = await containerService.getOrCreateCluster({
      clusterName: settings.ecsClusterName,
      tags
    })

    logger.debug(`Using ECS Cluster ${ecsCluster.clusterName}`)

    const {bucketName: workspaceBucketName, tearDown: bucketTearDown} =
      await bucketService.createBucket({
        accessRoleArn: settings.taskRoleArn,
        bucketName: settings.uniqueExecutionId,
        tags
      })

    this.tearDownQueue.push(bucketTearDown)

    await bucketService.syncUp({
      localWorkspacePath: settings.runnerWorkspaceFolder,
      bucketName: `s3://${workspaceBucketName}`,
      excludes: settings.uploadExcludes,
      includes: settings.uploadIncludes
    })
    logger.debug(`Workspace uploaded successfully`)

    const {taskDefinition, tearDown: taskDefinitionTearDown} =
      await containerService.createTaskDefinition({
        clusterName: settings.ecsClusterName,
        cpu: settings.cpu,
        executionRoleArn: settings.executionRoleArn,
        image: settings.image,
        memory: settings.memory,
        runScript: settings.run,
        shell: settings.shell,
        tags,
        taskDefinitionName: settings.uniqueExecutionId,
        taskRoleArn: settings.taskRoleArn,
        workspaceBucket: workspaceBucketName,
        downloadExcludes: settings.downloadExcludes,
        downloadIncludes: settings.downloadIncludes
      })

    this.tearDownQueue.push(taskDefinitionTearDown)

    logger.debug(`Created Task Definition: ${taskDefinition.family!}`)

    const subnetIds = await networkService.findSubnetIds({
      subnetIds: settings.subnetIds,
      vpcId: settings.vpcId
    })
    logger.debug(`Task will run on Subnet IDS: ${subnetIds}`)

    const {securityGroupId, tearDown: tearDownSecurityGroup} =
      await networkService.getOrCreateSecurityGroup({
        name: settings.uniqueExecutionId,
        securityGroupId: settings.securityGroupId,
        tags,
        vpcId: settings.vpcId
      })

    this.tearDownQueue.push(tearDownSecurityGroup)

    logger.debug(`Security Group to be used: ${securityGroupId}`)

    /// Starts the remote execution inside an ECS Task

    logger.debug(`Starting ECS Task`)
    const executionTask = await containerService.runTaskAndWaitUntilRunning({
      clusterName: settings.ecsClusterName,
      securityGroupId,
      subnetIds,
      tags,
      taskDefinitionName: settings.uniqueExecutionId,
      timeout: 300000
    })

    logger.debug(`Streaming Cloudwatch Logs until task reaches STOPPED state`)
    // Listen for logs until task reaches stopped status
    logger.info('Remote Execution Started, Logs Will Stream Below')
    logger.info(
      '""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""'
    )
    const {task: stoppedTask, tearDown: tearDownLogs} =
      await logStreamingService.streamLogsUntilStopped({
        clusterName: settings.ecsClusterName,
        pollingInterval: settings.pollingInterval,
        postCompleteLogCycles: settings.postCompleteLogCycles,
        taskArn: executionTask.taskArn!,
        taskDefinition
      })

    this.tearDownQueue.push(tearDownLogs)

    logger.info(
      '""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""'
    )
    logger.debug(`ECS Task execution completed`)

    /**
     * Fetch generated artifacts and return results
     */
    await bucketService.syncDown({
      localWorkspacePath: settings.runnerWorkspaceFolder,
      bucketName: `s3://${workspaceBucketName}`,
      excludes: settings.downloadExcludes,
      includes: settings.downloadIncludes
    })

    const allSuccess = stoppedTask.containers!.every(it => it.exitCode === 0)!

    const exitCode = allSuccess ? 0 : 1

    if (exitCode !== 0) {
      logger.info(`ECS Task failed with reason: ${stoppedTask.stoppedReason}`)
    }

    return {
      exitCode,
      ecsCluster,
      ecsTask: stoppedTask,
      ecsTaskDefinition: taskDefinition,
      s3WorkspaceBucket: workspaceBucketName
    }
  }

  async tearDown(): Promise<void> {
    await Promise.all(
      this.tearDownQueue.map(async tearDown => await tearDown())
    )
  }
}
