import {CloudWatchLogs, ECS} from 'aws-sdk'
import {Logger} from '../../core/provider/Logger'
import {ContainerService} from './ContainerService'
import {DeletableResource} from '../../core/domain/DeletableResource'

export interface LogStreamingServiceDependencies {
  logger: Logger
  cloudwatchLogs: CloudWatchLogs
  ecs: ECS
}

export interface FinishedTaskResource extends DeletableResource {
  task: ECS.Task
}
export class LogStreamingService {
  constructor(private readonly dependencies: LogStreamingServiceDependencies) {}

  async streamLogsUntilStopped({
    pollingInterval,
    postCompleteLogCycles,
    taskArn,
    clusterName,
    taskDefinition
  }: {
    taskArn: string
    pollingInterval: number
    postCompleteLogCycles: number
    clusterName: string
    taskDefinition: ECS.TaskDefinition
  }): Promise<FinishedTaskResource> {
    const {cloudwatchLogs, ecs, logger} = this.dependencies

    const taskId = taskArn.split(`:task/${clusterName}/`)[1]

    const POLLING_INTERVAL = pollingInterval * 1000

    return await new Promise<FinishedTaskResource>(resolve => {
      let nextToken: string | undefined
      let taskStopped = false
      let remainingPollingCycles = postCompleteLogCycles
      const timer = setInterval(async () => {
        const mainContainerDefinition =
          taskDefinition.containerDefinitions?.find(
            it => (it.name = ContainerService.MAIN_CONTAINER_NAME)
          )!

        const logstreamName = `${
          mainContainerDefinition.logConfiguration!.options![
            'awslogs-stream-prefix'
          ]
        }/${ContainerService.MAIN_CONTAINER_NAME}/${taskId}`
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

        logs.events
          ?.map(it => it.message)
          .forEach(log => {
            logger.info(log!)
          })

        const taskState = await ecs
          .describeTasks({tasks: [taskArn], cluster: clusterName})
          .promise()

        taskStopped = taskState.tasks![0]!.lastStatus === 'STOPPED'
        if (taskStopped && remainingPollingCycles === 0) {
          resolve({
            task: taskState.tasks![0]!,
            tearDown: async () =>
              await this.deleteLogStream({taskDefinition, taskId})
          })
          clearInterval(timer)
        } else {
          if (taskStopped) {
            remainingPollingCycles--
          }
          logger.debug(
            `lastState: ${
              taskState.tasks![0]!.lastStatus
            }, remainingPollingCycles: ${remainingPollingCycles}`
          )
        }
      }, POLLING_INTERVAL)
    })
  }

  /**
   * Deletes the Cloudwatch Logstream from a specific ECS Task Execution
   */
  async deleteLogStream({
    taskDefinition,
    taskId
  }: {
    taskDefinition: ECS.TaskDefinition
    taskId: string
  }): Promise<void> {
    const {logger, cloudwatchLogs} = this.dependencies
    await Promise.all(
      taskDefinition.containerDefinitions!.map(async it => {
        const logStreamName = `${
          it.logConfiguration!.options!['awslogs-stream-prefix']
        }/${it.name}/${taskId}`
        const logGroupName = it.logConfiguration!.options!['awslogs-group']
        logger.debug(`Deleting Logstream ${logGroupName}/${logStreamName}`)
        return await cloudwatchLogs
          .deleteLogStream({
            logGroupName,
            logStreamName
          })
          .promise()
      })
    )
  }
}
