import AWS, {Credentials, ECS} from 'aws-sdk'
import {mock} from 'jest-mock-extended'
import {BucketResource, BucketService} from '../awsServices/BucketService'
import {
  ContainerService,
  TaskDefinitionResource
} from '../awsServices/ContainerService'
import {
  FinishedTaskResource,
  LogStreamingService
} from '../awsServices/LogStreamingService'
import {
  NetworkService,
  SecurityGroupResource
} from '../awsServices/NetworkService'
import {AWSECSRemoteEnvironment} from './AWSECSRemoteEnvironment'
import {ECSExecutionSettings} from './ECSExecutionSettings'
import AWSMock from 'aws-sdk-mock'

jest.mock('../awsServices/BucketService')
jest.mock('../awsServices/ContainerService')
jest.mock('../awsServices/LogStreamingService')
jest.mock('../awsServices/NetworkService')

describe('AWSECSRemoteEnvironment', () => {
  const makeSut = (
    executionSettingsOverride?: Partial<ECSExecutionSettings>,
    containerExitCode: number = 0
  ) => {
    const region = 'us-east-1'
    const webIdentityToken = 'mockedWebIdentityToken'
    const roleArn = 'mockedRoleArn'

    AWSMock.setSDKInstance(AWS)

    const mockedAwsCredentials = mock<Credentials>({
      accessKeyId: 'accessKeyId',
      secretAccessKey: 'secretAccessKey',
      sessionToken: 'sessionToken'
    })

    const assumeRoleWithWebIdentity = jest
      .fn()
      .mockImplementation((input, callback) => {
        callback(null, {Credentials: mockedAwsCredentials})
      })

    AWSMock.mock('STS', 'assumeRoleWithWebIdentity', assumeRoleWithWebIdentity)

    const ecsExecutionSettings: ECSExecutionSettings = {
      cpu: '256',
      memory: '512',
      ecsClusterName: 'clustername',
      executionRoleArn: 'executionRoleArn',
      image: 'terraform',
      run: 'echo hello-world',
      securityGroupId: 'sg-id',
      shell: 'bash',
      subnetIds: ['subnet-id1', 'subnet-id2'],
      taskRoleArn: 'taskRoleArn',
      uniqueExecutionId: 'uniqueExecutionId',
      vpcId: 'vpc-id',
      tags: {custom: `tag`},
      runnerWorkspaceFolder: __dirname,
      pollingInterval: 1,
      postCompleteLogCycles: 1,
      uploadIncludes: [],
      uploadExcludes: [],
      downloadIncludes: [],
      downloadExcludes: [],
      ...(executionSettingsOverride ? executionSettingsOverride : {})
    }

    const mockedEcsCluster = mock<ECS.Cluster>({
      clusterArn: 'clusterArn',
      clusterName: ecsExecutionSettings.ecsClusterName
    })

    const getOrCreateCluster = jest.fn().mockResolvedValue(mockedEcsCluster)

    const tearDownTaskDefinition = jest.fn()
    const taskDefinitionResource = mock<TaskDefinitionResource>({
      tearDown: tearDownTaskDefinition,
      taskDefinition: mock<ECS.TaskDefinition>({
        family: 'family',
        cpu: ecsExecutionSettings.cpu,
        memory: ecsExecutionSettings.memory,
        executionRoleArn: ecsExecutionSettings.executionRoleArn,
        taskRoleArn: ecsExecutionSettings.taskRoleArn,
        containerDefinitions: [
          {
            name: ecsExecutionSettings.uniqueExecutionId,
            logConfiguration: {
              options: {
                'awslogs-create-group': 'true',
                'awslogs-group': ecsExecutionSettings.ecsClusterName,
                'awslogs-region': region,
                'awslogs-stream-prefix': 'aws-run-logs'
              }
            }
          }
        ]
      })
    })

    const createTaskDefinition = jest
      .fn()
      .mockResolvedValue(taskDefinitionResource)

    const ecsTask = mock<ECS.Task>({
      taskArn: 'taskArn'
    })

    const runTaskAndWaitUntilRunning = jest.fn().mockResolvedValue(ecsTask)

    ;(ContainerService as any).mockImplementation(() => {
      return {
        getOrCreateCluster,
        runTaskAndWaitUntilRunning,
        createTaskDefinition,
        deleteTaskDefinition: jest.fn()
      }
    })

    const tearDownBucket = jest.fn()

    const createdBucketResource = mock<BucketResource>({
      bucketName: ecsExecutionSettings.uniqueExecutionId,
      tearDown: tearDownBucket
    })
    const createBucket = jest.fn().mockResolvedValue(createdBucketResource)

    ;(BucketService as jest.Mock).mockImplementation(() => {
      return {
        createBucket,
        deleteBucket: jest.fn(),
        syncUp: jest.fn(),
        syncDown: jest.fn()
      }
    })

    const subnetIds = ['subnet1', 'subnet-2']

    const findSubnetIds = jest.fn().mockResolvedValue(subnetIds)

    const tearDownSecurityGroup = jest.fn()
    const securityGroupResource = mock<SecurityGroupResource>({
      securityGroupId: 'security-group-id',
      tearDown: tearDownSecurityGroup
    })

    const getOrCreateSecurityGroup = jest
      .fn()
      .mockResolvedValue(securityGroupResource)

    ;(NetworkService as jest.Mock).mockImplementation(() => {
      return {
        findSubnetIds,
        getOrCreateSecurityGroup,
        deleteSecurityGroup: jest.fn()
      }
    })

    const tearDownLogs = jest.fn()
    const finishedTaskResource = mock<FinishedTaskResource>({
      tearDown: tearDownLogs,
      task: mock<ECS.Task>({
        lastStatus: 'STOPPED',
        containers: [
          {
            exitCode: containerExitCode,
            name: ecsExecutionSettings.uniqueExecutionId
          }
        ]
      })
    })
    const streamLogsUntilStopped = jest
      .fn()
      .mockResolvedValue(finishedTaskResource)

    ;(LogStreamingService as jest.Mock).mockImplementation(() => {
      return {
        streamLogsUntilStopped,
        deleteLogStream: jest.fn()
      }
    })

    return {
      Sut: AWSECSRemoteEnvironment,
      region,
      webIdentityToken,
      roleArn,
      ecsExecutionSettings,
      tearDownLogs,
      tearDownTaskDefinition,
      tearDownBucket,
      tearDownSecurityGroup
    }
  }

  describe('execute', () => {
    it('correctly creates the AWS Infrastructure, execute the remote code, and return the status, when no existing infrastructure exists', async () => {
      // Given
      const {Sut, region, roleArn, webIdentityToken, ecsExecutionSettings} =
        makeSut()
      // When
      const awsEcsRemoteEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      const receivedResult = await awsEcsRemoteEnvironment.execute({
        settings: ecsExecutionSettings
      })
      // Then
      expect(receivedResult.exitCode).toBe(0)
    })

    it('should return exit code 1 if one of the containers fail', async () => {
      // Given
      const {Sut, region, roleArn, webIdentityToken, ecsExecutionSettings} =
        makeSut({}, 1)
      // When
      const awsEcsRemoteEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      const receivedResult = await awsEcsRemoteEnvironment.execute({
        settings: ecsExecutionSettings
      })
      // Then
      expect(receivedResult.exitCode).toBe(1)
    })
  })

  describe('tearDown', () => {
    it('invokes all tearDown functions from the tearDown queue', async () => {
      // Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        tearDownBucket,
        tearDownLogs,
        tearDownSecurityGroup,
        tearDownTaskDefinition
      } = makeSut()
      // When
      const awsEcsRemoteEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      const receivedResult = await awsEcsRemoteEnvironment.execute({
        settings: ecsExecutionSettings
      })

      await awsEcsRemoteEnvironment.tearDown()
      // Then
      expect(receivedResult.exitCode).toBe(0)
      expect(tearDownBucket).toHaveBeenCalled()
      expect(tearDownLogs).toHaveBeenCalled()
      expect(tearDownSecurityGroup).toHaveBeenCalled()
      expect(tearDownTaskDefinition).toHaveBeenCalled()
    }, 10000)
  })

  describe('fromGithubOidc', () => {
    it('returns an instance of AWSECSRemoteEnvironment', async () => {
      // Given
      const {Sut, region, roleArn, webIdentityToken} = makeSut()
      // When
      const receivedInstance = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })
      // Then
      expect(receivedInstance).toBeInstanceOf(AWSECSRemoteEnvironment)
    })
  })

  describe('fromDefault', () => {
    it('returns an instance of AWSECSRemoteEnvironment', async () => {
      // Given
      const {Sut, region, roleArn} = makeSut()
      // When
      const receivedInstance = await Sut.fromDefault({
        region
      })
      // Then
      expect(receivedInstance).toBeInstanceOf(AWSECSRemoteEnvironment)
    })
  })
})
