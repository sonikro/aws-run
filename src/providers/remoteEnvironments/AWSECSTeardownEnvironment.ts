/* eslint-disable github/no-then */
import {S3Client} from '@aws-sdk/client-s3'
import {CloudWatchLogs, EC2, ECS, S3, STS} from 'aws-sdk'
import S3SyncClient from 's3-sync-client'
import {RemoteEnvironmentTeardown} from '../../core/provider/RemoteEnvironmentTeardown'
import {GHALogger} from '../GHALogger'
import {BucketService} from '../awsServices/BucketService'
import {ContainerService} from '../awsServices/ContainerService'
import {LogStreamingService} from '../awsServices/LogStreamingService'
import {NetworkService} from '../awsServices/NetworkService'
import {ECSExecutionSettings} from './ECSExecutionSettings'
import {Logger} from '../../core/provider/Logger'

export interface AWSECSTeardownEnvironmentDependencies {
  bucketService: BucketService
  networkService: NetworkService
  containerService: ContainerService
  logStreamingService: LogStreamingService
  logger: Logger
}

export class AWSECSTeardownEnvironment implements RemoteEnvironmentTeardown {
  constructor(
    private readonly dependencies: AWSECSTeardownEnvironmentDependencies
  ) {}

  static async fromGithubOidc({
    region,
    webIdentityToken,
    roleArn
  }: {
    region: string
    webIdentityToken: string
    roleArn: string
  }): Promise<AWSECSTeardownEnvironment> {
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

    const s3 = new S3({
      region,
      credentials
    })

    const s3Client = new S3Client({
      region,
      credentials
    })
    const ecs = new ECS({
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

    return new AWSECSTeardownEnvironment({
      bucketService,
      containerService,
      logStreamingService,
      networkService,
      logger
    })
  }

  async tearDown({settings}: {settings: ECSExecutionSettings}): Promise<void> {
    const {
      bucketService,
      containerService,
      logStreamingService,
      networkService,
      logger
    } = this.dependencies
    const {uniqueExecutionId} = settings

    const taskPromise = containerService.getTaskByExecutionId({
      executionId: uniqueExecutionId,
      clusterName: settings.ecsClusterName
    })

    const deleteBucket = async (): Promise<void> => {
      try {
        await bucketService.deleteBucket({bucketName: uniqueExecutionId})
      } catch (error: any) {
        logger.debug(`Error deleting bucket: ${JSON.stringify(error, null, 2)}`)
        if (error?.code === 'NoSuchBucket') {
          logger.info(`Bucket ${uniqueExecutionId} does not exist. Ignoring it`)
          return
        }
        throw error
      }
    }

    const deleteSecurityGroup = async (): Promise<void> => {
      if (settings.securityGroupId === '') {
        const generatedSgId = await networkService.getSecurityGroupIdByname({
          name: uniqueExecutionId
        })
        if (generatedSgId) {
          await networkService.deleteSecurityGroup({
            securityGroupId: generatedSgId
          })
        }
      }
    }

    const stopEcsTaskIfRunning = async (task: ECS.Task): Promise<ECS.Task> => {
      const taskId = ContainerService.extractTaskIdFromArn({
        clusterName: settings.ecsClusterName,
        taskArn: task.taskArn!
      })

      if (task.lastStatus !== 'STOPPED') {
        logger.debug(
          `ECS Task ${taskId} is not stopped. Forcing the task to stop.`
        )
        await containerService.stopTask({
          clusterName: settings.ecsClusterName,
          taskId,
          reason: 'aws-run aborted'
        })
        logger.debug(`ECS Task ${taskId} aborted successfully`)
      }
      return task
    }

    const deleteEcsResources = async (
      task: ECS.Task | undefined
    ): Promise<void> => {
      try {
        const deletedTaskDefinition =
          await containerService.deleteTaskDefinition({
            taskDefinitionId: uniqueExecutionId,
            revisionNumber: '1'
          })
        if (task !== undefined && deletedTaskDefinition) {
          const taskId = ContainerService.extractTaskIdFromArn({
            clusterName: settings.ecsClusterName,
            taskArn: task.taskArn!
          })
          await logStreamingService.deleteLogStream({
            taskDefinition: deletedTaskDefinition,
            taskId
          })
        }
      } catch (error: any) {
        logger.debug(
          `Error deleting ECS Resources: ${JSON.stringify(error, null, 2)}`
        )
        if (error?.code === 'ResourceNotFoundException') {
          logger.info(`Skipping since resource does not exist`)
          return
        }
        throw error
      }
    }

    const stoppedEcsPromise = taskPromise.then(async task => {
      if (task) {
        return await stopEcsTaskIfRunning(task)
      }
    })
    const deleteSgPromise = stoppedEcsPromise.then(
      async () => await deleteSecurityGroup()
    )
    const deleteEcsResourcesPromise = stoppedEcsPromise.then(async task => {
      await deleteEcsResources(task)
    })

    const tearDownPromises = [
      await deleteBucket(),
      deleteSgPromise,
      deleteEcsResourcesPromise
    ]

    await Promise.all(tearDownPromises)
  }
}
