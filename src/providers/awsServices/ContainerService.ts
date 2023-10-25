import {ECS} from 'aws-sdk'
import {ContainerDefinition} from 'aws-sdk/clients/ecs'
import {DeletableResource} from '../../core/domain/DeletableResource'
import {Logger} from '../../core/provider/Logger'
import {Tags} from './SharedTypes'

export interface ContainerServiceDependencies {
  ecs: ECS
  logger: Logger
}

export interface TaskDefinitionResource extends DeletableResource {
  taskDefinition: ECS.TaskDefinition
}

export class ContainerService {
  static WORKSPACE_VOLUME_NAME = 'runner-workspace'
  static SETUP_WORKSPACE_CONTAINER_NAME = 'workspace-setup'
  static TEARDOWN_WORKSPACE_CONTAINER_NAME = 'workspace-teardown'
  static MAIN_CONTAINER_NAME = 'main-container'

  constructor(private readonly dependencies: ContainerServiceDependencies) {}

  async getOrCreateCluster({
    clusterName,
    tags
  }: {
    clusterName: string
    tags: Tags
  }): Promise<ECS.Cluster> {
    const {ecs, logger} = this.dependencies

    const existingClusterResponse = await ecs
      .describeClusters({
        clusters: [clusterName]
      })
      .promise()

    if (existingClusterResponse.clusters?.length === 1) {
      return existingClusterResponse.clusters[0]
    }

    const newClusterResponse = await ecs
      .createCluster({
        capacityProviders: ['FARGATE'],
        clusterName,
        tags: this.toEcsTags(tags)
      })
      .promise()

    logger.debug(`Created cluster ${newClusterResponse.cluster!}`)

    return newClusterResponse.cluster!
  }

  async runTaskAndWaitUntilRunning({
    clusterName,
    securityGroupId,
    subnetIds,
    taskDefinitionName,
    tags,
    timeout
  }: {
    clusterName: string
    subnetIds: string[]
    securityGroupId: string
    taskDefinitionName: string
    tags: Tags
    timeout: number
  }): Promise<ECS.Task> {
    const {ecs, logger} = this.dependencies
    const task = await ecs
      .runTask({
        cluster: clusterName,
        launchType: 'FARGATE',
        startedBy: 'github-actions',
        networkConfiguration: {
          awsvpcConfiguration: {
            assignPublicIp: 'ENABLED',
            subnets: subnetIds,
            securityGroups: [securityGroupId]
          }
        },
        tags: this.toEcsTags(tags),
        taskDefinition: taskDefinitionName
      })
      .promise()

    const executionTask = task.tasks![0]!
    logger.debug(`Waiting until ECS Task is running`)
    return await this.waitForContainer({
      containerName: ContainerService.MAIN_CONTAINER_NAME,
      taskArn: executionTask.taskArn!,
      clusterName,
      timeout
    })
  }

  private async waitForContainer({
    containerName,
    taskArn,
    clusterName,
    timeout
  }: {
    taskArn: string
    containerName: string
    clusterName: string
    timeout: number
  }): Promise<ECS.Task> {
    const {ecs, logger} = this.dependencies
    const POLLING_INTERVAL = 2000

    logger.debug(
      `Waiting for container ${containerName} to reach a valid running status`
    )

    let describeInterval: ReturnType<typeof setInterval> | undefined
    let timeoutTimeout: ReturnType<typeof setTimeout> | undefined

    const containerPromise = new Promise<ECS.Task>(resolve => {
      describeInterval = setInterval(async () => {
        const tasks = await ecs
          .describeTasks({tasks: [taskArn], cluster: clusterName})
          .promise()

        const task = tasks.tasks![0]

        const container = task.containers?.find(it => it.name === containerName)

        logger.debug(
          `Container ${containerName} lastStatus = ${container!.lastStatus}`
        )

        if (
          container!.lastStatus === 'RUNNING' ||
          container!.lastStatus === 'STOPPED'
        ) {
          logger.debug(
            `Container ${containerName} reached expected status of ${
              container!.lastStatus
            }`
          )
          resolve(task)
          clearInterval(describeInterval)
        }
      }, POLLING_INTERVAL)
    })

    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimeout = setTimeout(() => {
        clearInterval(describeInterval)
        reject(
          new Error(
            `Timed out waiting for container ${containerName} to reach valid RUNNING status`
          )
        )
      }, timeout)
    })

    const cleanupClocks = (): void => {
      clearInterval(describeInterval)
      clearTimeout(timeoutTimeout)
    }

    const race = Promise.race([containerPromise, timeoutPromise])
      // eslint-disable-next-line github/no-then
      .then(result => {
        cleanupClocks()
        return result
      })
      // eslint-disable-next-line github/no-then
      .catch(error => {
        cleanupClocks()
        throw error
      })

    const task = (await race) as ECS.Task

    return task
  }

  async createTaskDefinition({
    taskDefinitionName,
    clusterName,
    image,
    runScript,
    shell,
    workspaceBucket,
    cpu,
    executionRoleArn,
    memory,
    taskRoleArn,
    tags,
    downloadExcludes,
    downloadIncludes
  }: {
    taskDefinitionName: string
    clusterName: string
    runScript: string
    image: string
    shell: string
    workspaceBucket: string
    cpu: string
    memory: string
    taskRoleArn: string
    executionRoleArn: string
    tags: Tags
    downloadExcludes: string[]
    downloadIncludes: string[]
  }): Promise<TaskDefinitionResource> {
    const {ecs} = this.dependencies

    const awsLogsParameters = {
      'awslogs-create-group': 'true',
      'awslogs-group': clusterName,
      'awslogs-region': ecs.config.region!,
      'awslogs-stream-prefix': 'aws-run-logs'
    }

    const unifiedCommand = runScript.split('\n').join(' && ')

    const workspaceContainerPath = '/workspace'

    const environmentValues = Object.keys(process.env).map(key => ({
      name: key,
      value: process.env[key]
    }))

    const mainContainerDefinition: ContainerDefinition = {
      image,
      essential: false,
      entryPoint: [shell, '-c'],
      command: [unifiedCommand],
      workingDirectory: workspaceContainerPath,
      name: ContainerService.MAIN_CONTAINER_NAME,
      environment: environmentValues,
      logConfiguration: {
        logDriver: 'awslogs',
        options: awsLogsParameters
      },
      dependsOn: [
        {
          containerName: ContainerService.SETUP_WORKSPACE_CONTAINER_NAME,
          condition: 'COMPLETE'
        }
      ],
      mountPoints: [
        {
          containerPath: workspaceContainerPath,
          sourceVolume: ContainerService.WORKSPACE_VOLUME_NAME
        }
      ]
    }

    const setupWorkspaceSidecarDefinition: ContainerDefinition = {
      name: ContainerService.SETUP_WORKSPACE_CONTAINER_NAME,
      image: 'amazon/aws-cli:2.13.1',
      essential: false,
      entryPoint: ['bash', '-c'],
      command: [`aws s3 sync s3://${workspaceBucket} .`],
      workingDirectory: workspaceContainerPath,
      mountPoints: [
        {
          containerPath: workspaceContainerPath,
          sourceVolume: ContainerService.WORKSPACE_VOLUME_NAME
        }
      ],
      logConfiguration: {
        logDriver: 'awslogs',
        options: awsLogsParameters
      }
    }

    const tearDownSyncArgs = this.createSyncArgs({
      excludes: downloadExcludes,
      includes: downloadIncludes
    })

    const teardownWorkspaceSidecarDefinition: ContainerDefinition = {
      name: ContainerService.TEARDOWN_WORKSPACE_CONTAINER_NAME,
      image: 'amazon/aws-cli:2.13.1',
      essential: true,
      entryPoint: ['bash', '-c'],
      command: [`aws s3 sync . s3://${workspaceBucket} ${tearDownSyncArgs}`],
      workingDirectory: workspaceContainerPath,
      mountPoints: [
        {
          containerPath: workspaceContainerPath,
          sourceVolume: ContainerService.WORKSPACE_VOLUME_NAME
        }
      ],
      dependsOn: [
        {
          containerName: ContainerService.MAIN_CONTAINER_NAME,
          condition: 'COMPLETE'
        }
      ],
      logConfiguration: {
        logDriver: 'awslogs',
        options: awsLogsParameters
      }
    }

    const taskDefinition = await ecs
      .registerTaskDefinition({
        family: taskDefinitionName,
        requiresCompatibilities: ['FARGATE'],
        networkMode: 'awsvpc',
        cpu,
        memory,
        executionRoleArn,
        taskRoleArn,
        volumes: [
          {
            name: ContainerService.WORKSPACE_VOLUME_NAME,
            host: {} // transient
          }
        ],
        containerDefinitions: [
          mainContainerDefinition,
          setupWorkspaceSidecarDefinition,
          teardownWorkspaceSidecarDefinition
        ],
        tags: this.toEcsTags(tags)
      })
      .promise()

    return {
      taskDefinition: taskDefinition.taskDefinition!,
      tearDown: async () => {
        await this.deleteTaskDefinition({
          taskDefinitionId: taskDefinition.taskDefinition!.family!,
          revisionNumber: '1'
        })
      }
    }
  }

  async deleteTaskDefinition({
    taskDefinitionId,
    revisionNumber
  }: {
    taskDefinitionId: string
    revisionNumber: string
  }): Promise<ECS.TaskDefinition | undefined> {
    const {ecs, logger} = this.dependencies
    try {
      const taskRevision = `${taskDefinitionId}:${revisionNumber}`
      await ecs
        .deregisterTaskDefinition({
          taskDefinition: taskRevision
        })
        .promise()
      const response = await ecs
        .deleteTaskDefinitions({
          taskDefinitions: [taskRevision]
        })
        .promise()

      logger.debug(
        `Deleted TaskDefinition ${taskDefinitionId}. Response failures: ${JSON.stringify(
          response.failures,
          null,
          2
        )}`
      )
      return response.taskDefinitions?.[0]
    } catch (e) {
      logger.debug(
        `Error deleting task definition: ${JSON.stringify(e, null, 2)}`
      )
      return undefined
    }
  }

  async getTaskByExecutionId({
    clusterName,
    executionId
  }: {
    clusterName: string
    executionId: string
  }): Promise<ECS.Task | undefined> {
    const {ecs, logger} = this.dependencies

    logger.debug(`Finding Tasks for Cluster ${clusterName}`)

    const stoppedTasks = await ecs
      .listTasks({
        cluster: clusterName,
        desiredStatus: 'STOPPED'
      })
      .promise()

    const runningTasks = await ecs
      .listTasks({
        cluster: clusterName,
        desiredStatus: 'RUNNING'
      })
      .promise()

    logger.debug(
      `ClusterTaskArns ${JSON.stringify(stoppedTasks?.taskArns, null, 2)}`
    )

    const tasks = [...stoppedTasks.taskArns!, ...runningTasks.taskArns!]
    if (tasks.length === 0) {
      logger.debug(`No running / stopped tasks found`)
      return undefined
    }

    const allClusterTasks = await ecs
      .describeTasks({
        cluster: clusterName,
        tasks,
        include: ['TAGS']
      })
      .promise()

    const executionTask = allClusterTasks.tasks!.filter(
      task =>
        task.tags?.find(
          tag => tag.key === 'executionId' && tag.value === executionId
        ) !== undefined
    )[0]

    logger.debug(
      `ExecutionTask Found: ${JSON.stringify(executionTask?.taskArn, null, 2)}`
    )

    return executionTask
  }

  async stopTask({
    clusterName,
    taskId,
    reason
  }: {
    clusterName: string
    taskId: string
    reason: string
  }): Promise<ECS.Task> {
    const {ecs} = this.dependencies

    const stopResponse = await ecs
      .stopTask({
        task: taskId,
        cluster: clusterName,
        reason
      })
      .promise()

    const stoppedTask = await ecs
      .waitFor('tasksStopped', {
        tasks: [stopResponse.task!.taskArn!],
        cluster: clusterName
      })
      .promise()

    return stoppedTask.tasks![0]!
  }

  private toEcsTags(tags: Tags): ECS.Tags {
    return Object.keys(tags).map(key => ({
      key,
      value: tags[key]
    }))
  }

  private createSyncArgs({
    excludes,
    includes
  }: {
    excludes: string[]
    includes: string[]
  }): string {
    const excludeArgs = excludes
      .map(exclude => `--exclude '${exclude}*'`)
      .join(' ')
    const includeArgs = includes
      .map(include => `--include '${include}*'`)
      .join(' ')
    const syncArgs = [excludeArgs, includeArgs].join(' ')
    return syncArgs
  }

  static extractTaskIdFromArn({
    clusterName,
    taskArn
  }: {
    taskArn: string
    clusterName: string
  }): string {
    return taskArn.split(`:task/${clusterName}/`)[1]
  }
}
