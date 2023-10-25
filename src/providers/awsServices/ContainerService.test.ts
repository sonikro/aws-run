import AWS, {ECS} from 'aws-sdk'
import AWSMock from 'aws-sdk-mock'
import {mock} from 'jest-mock-extended'
import {GHALogger} from '../GHALogger'
import {Tags} from '../awsServices/SharedTypes'
import {ContainerService} from './ContainerService'
import {Logger} from '../../core/provider/Logger'

describe('ContainerService', () => {
  afterEach(() => {
    AWSMock.restore()
  })

  describe('getOrCreateCluster', () => {
    it('returns data from an existing ECS Cluster', async () => {
      // Given
      const {sut, tags, describedClusters, clusterName} = makeSut()
      // When
      const receivedCluster = await sut.getOrCreateCluster({clusterName, tags})
      // Then
      expect(receivedCluster).toBe(describedClusters.clusters![0])
    })
    it("creates a new fargate cluster, if the cluster doesn't exist yet", async () => {
      // Given
      const {
        sut,
        tags,
        describeClusters,
        createCluster,
        createdCluster,
        expectedTags,
        clusterName
      } = makeSut()
      describeClusters.mockImplementation((_, callback) => {
        callback(null, mock<ECS.DescribeClustersResponse>({clusters: []}))
      })
      // When
      const receivedCluster = await sut.getOrCreateCluster({clusterName, tags})
      // Then
      expect(receivedCluster).toBe(createdCluster.cluster)
      expect(createCluster.mock.calls[0][0].tags).toMatchObject(expectedTags)
    })
  })

  const makeSut = () => {
    AWSMock.setSDKInstance(AWS)

    const executionId = 'execution-id'
    const tags: Tags = {
      tagKey: 'tagValue'
    }

    const expectedTags: ECS.Tags = [{key: 'tagKey', value: 'tagValue'}]

    const clusterName = 'aws-run-cluster'

    const describedClusters = mock<ECS.DescribeClustersResponse>({
      clusters: [
        {
          clusterName
        }
      ]
    })
    const describeClusters = jest.fn().mockImplementation((_, callback) => {
      callback(null, describedClusters)
    })
    AWSMock.mock('ECS', 'describeClusters', describeClusters)

    const createdCluster = mock<ECS.CreateClusterResponse>({
      cluster: {clusterName}
    })

    const createCluster = jest.fn().mockImplementation((_, callback) => {
      callback(null, createdCluster)
    })
    AWSMock.mock('ECS', 'createCluster', createCluster)

    const runTaskResponse = mock<ECS.RunTaskResponse>({
      tasks: [{taskArn: 'taskArn'}]
    })
    const runTask = jest.fn().mockImplementation((_, callback) => {
      callback(null, runTaskResponse)
    })
    AWSMock.mock('ECS', 'runTask', runTask)

    const waitForTaskResponse = mock<ECS.DescribeTasksResponse>({
      tasks: [{taskArn: 'taskArn'}]
    })
    // waitFor has a bug where it doesn't work with a jest.fn() function. Tracked here https://github.com/dwyl/aws-sdk-mock/issues/273
    const waitFor = (_: unknown, __: unknown, callback: Function) => {
      callback(null, waitForTaskResponse)
    }
    AWSMock.mock('ECS', 'waitFor', waitFor)

    const registerTaskDefinitionResponse =
      mock<ECS.RegisterTaskDefinitionResponse>({
        taskDefinition: {family: 'taskDefinitionFamily'}
      })
    const registerTaskDefinition = jest
      .fn()
      .mockImplementation((_, callback) => {
        callback(null, registerTaskDefinitionResponse)
      })
    AWSMock.mock('ECS', 'registerTaskDefinition', registerTaskDefinition)

    const deleteTaskDefinition = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('ECS', 'deleteTaskDefinitions', deleteTaskDefinition)

    const deregisterTaskDefinition = jest
      .fn()
      .mockImplementation((_, callback) => {
        callback(null, {})
      })
    AWSMock.mock('ECS', 'deregisterTaskDefinition', deregisterTaskDefinition)

    const listTaskResponse = mock<ECS.ListTasksResponse>({
      taskArns: [`arn:aws:ecs:us-east-1:11111111:task/${clusterName}/task-id`]
    })
    const listTasks = jest.fn().mockImplementation((_, callback) => {
      callback(null, listTaskResponse)
    })
    AWSMock.mock('ECS', 'listTasks', listTasks)

    const describeTasksResponse = mock<ECS.DescribeTasksResponse>({
      tasks: [
        mock<ECS.Task>({
          tags: [{key: 'executionId', value: executionId}],
          taskArn: `arn:aws:ecs:us-east-1:11111111:task/${clusterName}/task-id`
        })
      ]
    })
    const describeTasks = jest.fn().mockImplementation((_, callback) => {
      callback(null, describeTasksResponse)
    })
    AWSMock.mock('ECS', 'describeTasks', describeTasks)

    const stopTaskResponse = mock<ECS.StopTaskResponse>({
      task: mock<ECS.Task>({
        lastStatus: 'STOPPED'
      })
    })

    const stopTask = jest.fn().mockImplementation((_, callback) => {
      callback(null, stopTaskResponse)
    })
    AWSMock.mock('ECS', 'stopTask', stopTask)

    const ecs = new ECS()
    const logger: Logger = {
      info: jest.fn(),
      debug: jest.fn()
    }
    const sut = new ContainerService({
      ecs,
      logger
    })
    return {
      sut,
      tags,
      describedClusters,
      describeClusters,
      clusterName,
      createCluster,
      createdCluster,
      runTask,
      runTaskResponse,
      waitForTaskResponse,
      waitFor,
      registerTaskDefinition,
      registerTaskDefinitionResponse,
      expectedTags,
      deleteTaskDefinition,
      listTaskResponse,
      listTasks,
      logger,
      describeTasksResponse,
      describeTasks,
      executionId,
      stopTask,
      stopTaskResponse
    }
  }

  describe('runTaskAndWaitUntilRunning', () => {
    it('runs the ECS Task and waits until the main container state is RUNNING', async () => {
      // Given
      const {sut, clusterName, tags, describeTasks, describeTasksResponse} =
        makeSut()
      describeTasksResponse.tasks![0].containers = [
        mock<ECS.Container>({
          name: ContainerService.MAIN_CONTAINER_NAME,
          lastStatus: `RUNNING`
        })
      ]

      const securityGroupId = 'sg-1'
      const subnetIds = ['subnet-1']
      const taskDefinitionName = 'taskName'
      // When
      const receivedRunningTask = await sut.runTaskAndWaitUntilRunning({
        clusterName,
        securityGroupId,
        subnetIds,
        tags,
        taskDefinitionName,
        timeout: 2000
      })
      // Then
      expect(receivedRunningTask).toBe(describeTasksResponse.tasks![0])
    })

    it('runs the ECS Task and waits until the main container state is STOPPED', async () => {
      // Given
      const {sut, clusterName, tags, describeTasks, describeTasksResponse} =
        makeSut()
      describeTasksResponse.tasks![0].containers = [
        mock<ECS.Container>({
          name: ContainerService.MAIN_CONTAINER_NAME,
          lastStatus: `STOPPED`
        })
      ]

      const securityGroupId = 'sg-1'
      const subnetIds = ['subnet-1']
      const taskDefinitionName = 'taskName'
      // When
      const receivedRunningTask = await sut.runTaskAndWaitUntilRunning({
        clusterName,
        securityGroupId,
        subnetIds,
        tags,
        taskDefinitionName,
        timeout: 2000
      })
      // Then
      expect(receivedRunningTask).toBe(describeTasksResponse.tasks![0])
    })

    it('throws an error if container does not reaches desired state before timeout', async () => {
      // Given
      const {sut, clusterName, tags, describeTasksResponse} = makeSut()

      const timeToTimeout = 1
      describeTasksResponse.tasks![0].containers = [
        mock<ECS.Container>({
          name: ContainerService.MAIN_CONTAINER_NAME,
          lastStatus: `PENDING`
        })
      ]

      const securityGroupId = 'sg-1'
      const subnetIds = ['subnet-1']
      const taskDefinitionName = 'taskName'
      // When
      const act = async () => {
        await sut.runTaskAndWaitUntilRunning({
          clusterName,
          securityGroupId,
          subnetIds,
          tags,
          taskDefinitionName,
          timeout: timeToTimeout
        })
      }
      // Then
      await expect(act()).rejects.toThrow()
    })
  })

  describe('createTaskDefinition', () => {
    it('creates the task definition and returns a tearDown function that destroys it', async () => {
      // Given
      const {
        sut,
        clusterName,
        tags,
        expectedTags,
        deleteTaskDefinition,
        registerTaskDefinition,
        registerTaskDefinitionResponse
      } = makeSut()
      // When
      const receivedResource = await sut.createTaskDefinition({
        clusterName,
        cpu: 'cpu',
        memory: 'memory',
        executionRoleArn: 'executionRoleArn',
        image: 'image',
        runScript: 'run',
        shell: 'bash',
        tags,
        taskDefinitionName: 'taskDefinitionName',
        taskRoleArn: 'taskRoleArn',
        workspaceBucket: 'workspace',
        downloadExcludes: ['exclude'],
        downloadIncludes: ['include']
      })

      await receivedResource.tearDown()
      // Then
      expect(receivedResource.taskDefinition).toBe(
        registerTaskDefinitionResponse.taskDefinition
      )
      expect(registerTaskDefinition.mock.calls[0][0].tags).toMatchObject(
        expectedTags
      )
      expect(deleteTaskDefinition).toHaveBeenCalled()
      // validates that the s3 sync command contains the correct includes and excludes
      expect(
        registerTaskDefinition.mock.calls[0][0].containerDefinitions[2]
          .command[0]
      ).toBe(
        `aws s3 sync . s3://workspace --exclude 'exclude*' --include 'include*'`
      )
    })
  })

  describe('getTaskByExecutionId', () => {
    it('returns the task based on an unique execution id', async () => {
      // Given
      const {sut, clusterName, executionId, describeTasksResponse} = makeSut()

      // When
      const actualTask = await sut.getTaskByExecutionId({
        clusterName,
        executionId
      })

      // Then
      expect(actualTask).toBe(describeTasksResponse.tasks![0])
    })

    it('returns undefined if no tasks exist', async () => {
      // Given
      const {sut, clusterName, executionId, listTaskResponse} = makeSut()
      listTaskResponse.taskArns = []

      // When
      const actualTask = await sut.getTaskByExecutionId({
        clusterName,
        executionId
      })

      // Then
      expect(actualTask).toBe(undefined)
    })
  })

  describe('stopTask', () => {
    it('stops an ecs task', async () => {
      // Given
      const {sut, clusterName, waitForTaskResponse} = makeSut()
      // When
      const actualStoppedTask = await sut.stopTask({
        clusterName,
        reason: 'reason',
        taskId: 'taskid'
      })
      // Then
      expect(actualStoppedTask).toBe(waitForTaskResponse.tasks![0])
    })
  })

  describe('deleteTaskDefinition', () => {
    it('deletes the task definition', async () => {
      // Given
      const {sut, deleteTaskDefinition} = makeSut()
      const taskDefinitionId = 'taskDefinitionId'

      // When
      await sut.deleteTaskDefinition({taskDefinitionId, revisionNumber: '1'})

      // Then
      expect(
        deleteTaskDefinition.mock.calls[0][0].taskDefinitions
      ).toMatchObject([`${taskDefinitionId}:1`])
    })

    it('prints err and returns undefined if failure deleting task definition', async () => {
      // Given
      const {sut, deleteTaskDefinition, logger} = makeSut()
      const taskDefinitionId = 'taskDefinitionId'
      const expectedError = new Error('some error')
      deleteTaskDefinition.mockRejectedValue(expectedError)

      // When
      const result = await sut.deleteTaskDefinition({
        taskDefinitionId,
        revisionNumber: '1'
      })

      // Then
      expect(result).toBe(undefined)
      expect(logger.debug).toHaveBeenNthCalledWith(
        1,
        `Error deleting task definition: ${JSON.stringify(
          expectedError,
          null,
          2
        )}`
      )
    })
  })

  describe('extractTaskIdFromArn', () => {
    it('correctly extracts a task ID from a TaskArn', () => {
      // Given
      const {clusterName} = makeSut()
      // When
      const actualTaskId = ContainerService.extractTaskIdFromArn({
        clusterName,
        taskArn: `arn:aws:ecs:us-east-1:11111111:task/${clusterName}/task-id`
      })
      // Then
      expect(actualTaskId).toBe(`task-id`)
    })
  })
})
