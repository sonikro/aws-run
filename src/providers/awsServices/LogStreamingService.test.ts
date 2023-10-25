import AWS, {CloudWatchLogs, ECS} from 'aws-sdk'
import {Logger} from '../../core/provider/Logger'
import {LogStreamingService} from './LogStreamingService'
import {mock} from 'jest-mock-extended'
import {ContainerService} from './ContainerService'
import AWSMock from 'aws-sdk-mock'

describe('LogStreamingService', () => {
  afterEach(() => {
    AWSMock.restore()
  })

  const makeSut = () => {
    AWSMock.setSDKInstance(AWS)

    const describeTaskResponse = mock<ECS.DescribeTasksResponse>({
      tasks: [{lastStatus: 'STOPPED'}]
    })
    const describeTasks = jest.fn().mockImplementation((_, callback) => {
      callback(null, describeTaskResponse)
    })
    AWSMock.mock('ECS', 'describeTasks', describeTasks)

    const getLogEventsResponse = mock<CloudWatchLogs.GetLogEventsResponse>({
      nextForwardToken: 'nextForwardToken',
      events: [{message: 'Log Message 1'}, {message: 'Log Message 2'}]
    })
    const getLogEvents = jest.fn().mockImplementation((_, callback) => {
      callback(null, getLogEventsResponse)
    })

    AWSMock.mock('CloudWatchLogs', 'getLogEvents', getLogEvents)
    const taskDefinition = mock<ECS.TaskDefinition>({
      containerDefinitions: [
        {
          name: ContainerService.MAIN_CONTAINER_NAME,
          logConfiguration: {
            options: {
              'awslogs-stream-prefix': 'prefix',
              'awslogs-group': 'groupName'
            }
          }
        }
      ]
    })

    const deleteLogStream = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('CloudWatchLogs', 'deleteLogStream', deleteLogStream)
    const logger: Logger = {
      info: jest.fn(),
      debug: jest.fn()
    }

    const ecs = new ECS()
    const cloudwatchLogs = new CloudWatchLogs()

    const sut = new LogStreamingService({
      cloudwatchLogs,
      ecs,
      logger
    })
    return {
      sut,
      logger,
      taskDefinition,
      describeTasks,
      describeTaskResponse,
      getLogEvents,
      getLogEventsResponse,
      deleteLogStream
    }
  }

  describe('streamLogsUntilStopped', () => {
    it('stream the logs from cloudwatch, while the task is running, and return a log tearDown function', async () => {
      // Given
      const {
        logger,
        sut,
        taskDefinition,
        getLogEvents,
        getLogEventsResponse,
        describeTaskResponse,
        deleteLogStream
      } = makeSut()
      // When
      const {task, tearDown} = await sut.streamLogsUntilStopped({
        clusterName: 'clusterName',
        pollingInterval: 1,
        postCompleteLogCycles: 1,
        taskArn: ':task/clusterName/taskId',
        taskDefinition
      })

      await tearDown()
      // Then
      expect(task).toBe(describeTaskResponse.tasks![0])
      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        getLogEventsResponse.events![0].message
      )
      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        getLogEventsResponse.events![1].message
      )

      // Validates that the postCompleteLogCycles was used, and logs were fetched twice
      expect(getLogEvents).toHaveBeenCalledTimes(2)

      // Validates the logStream were deleted by the tearDown
      expect(deleteLogStream).toHaveBeenCalled()
    })
  })

  describe('deleteLogStream', () => {
    it('deletes all logstreams generated for a specific ECS Task', async () => {
      // Given
      const {sut, taskDefinition, deleteLogStream} = makeSut()
      const mainContainerDefinition = taskDefinition.containerDefinitions![0]
      const containerLogOptions =
        mainContainerDefinition.logConfiguration!.options!
      const taskId = ':task/clusterName/taskId'
      const expectedLogGroupName = containerLogOptions['awslogs-group']
      const expectedLogStreamName = `${containerLogOptions['awslogs-stream-prefix']}/${mainContainerDefinition.name}/${taskId}`
      // When
      await sut.deleteLogStream({
        taskDefinition,
        taskId: ':task/clusterName/taskId'
      })

      // Then
      expect(deleteLogStream.mock.calls[0][0].logGroupName).toBe(
        expectedLogGroupName
      )
      expect(deleteLogStream.mock.calls[0][0].logStreamName).toBe(
        expectedLogStreamName
      )
    })
  })
})
