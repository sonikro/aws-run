import AWS, {AWSError, CloudWatchLogs, Credentials, EC2, ECS, S3} from 'aws-sdk'
import AWSMock from 'aws-sdk-mock'
import {PromiseResult} from 'aws-sdk/lib/request'
import {mock} from 'jest-mock-extended'
import {
  AWSECSRemoteEnvironment,
  ECSExecutionSettings
} from './AWSECSRemoteEnvironment'

describe('AWSECSRemoteEnvironment', () => {
  afterEach(() => {
    AWSMock.restore()
  })

  const makeSut = (
    executionSettingsOverride?: Partial<ECSExecutionSettings>
  ) => {
    const region = 'us-east-1'
    const webIdentityToken = 'mockedWebIdentityToken'
    const roleArn = 'mockedRoleArn'

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
      runnerWorkspaceFolder: __dirname,
      ...(executionSettingsOverride ? executionSettingsOverride : {})
    }

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

    const mockedDescribeClusterResult = mock<
      PromiseResult<ECS.DescribeClustersResponse, AWSError>
    >({
      clusters: []
    })
    const describeClusters = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockedDescribeClusterResult)
    })
    AWSMock.mock('ECS', 'describeClusters', describeClusters)

    const mockedEcsCluster = mock<ECS.Cluster>({
      clusterArn: 'clusterArn',
      clusterName: ecsExecutionSettings.ecsClusterName
    })
    const mockedCreateClusterResult = mock<
      PromiseResult<ECS.CreateClusterResponse, AWSError>
    >({
      cluster: mockedEcsCluster
    })
    const createCluster = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockedCreateClusterResult)
    })
    AWSMock.mock('ECS', 'createCluster', createCluster)

    const mockCreateBucketResult =
      mock<PromiseResult<S3.CreateBucketOutput, AWSError>>()
    const createBucket = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockCreateBucketResult)
    })
    AWSMock.mock('S3', 'createBucket', createBucket)

    const putBucketPolicy = jest.fn().mockImplementation((input, callback) => {
      callback(null, {})
    })

    AWSMock.mock('S3', 'putBucketPolicy', putBucketPolicy)

    const putObject = jest.fn().mockImplementation((input, callback) => {
      callback(null, {})
    })
    AWSMock.mock('S3', 'putObject', putObject)

    const mockRegisterTaskDefinitionResult = mock<
      PromiseResult<ECS.RegisterTaskDefinitionResponse, AWSError>
    >({
      taskDefinition: {
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
      }
    })
    const registerTaskDefinition = jest
      .fn()
      .mockImplementation((input, callback) => {
        callback(null, mockRegisterTaskDefinitionResult)
      })
    AWSMock.mock('ECS', 'registerTaskDefinition', registerTaskDefinition)

    const mockRunTaskResult = mock<
      PromiseResult<ECS.RunTaskResponse, AWSError>
    >({
      tasks: [
        {
          taskArn: 'ecsTaskArn'
        }
      ]
    })
    const runTask = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockRunTaskResult)
    })
    AWSMock.mock('ECS', 'runTask', runTask)

    AWSMock.mock('ECS', 'waitFor', '')

    const mockGetLogEventsResult = mock<
      PromiseResult<CloudWatchLogs.GetLogEventsResponse, AWSError>
    >({
      nextForwardToken: 'nextForwardToken',
      events: [
        {
          message: 'someLog'
        }
      ]
    })
    const getLogEvents = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockGetLogEventsResult)
    })

    AWSMock.mock('CloudWatchLogs', 'getLogEvents', getLogEvents)

    const mockDescribeTasksResult = mock<
      PromiseResult<ECS.DescribeTasksResponse, AWSError>
    >({
      tasks: [
        {
          lastStatus: 'STOPPED',
          containers: [
            {
              exitCode: 0,
              name: ecsExecutionSettings.uniqueExecutionId
            }
          ]
        }
      ]
    })
    const describeTasks = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockDescribeTasksResult)
    })
    AWSMock.mock('ECS', 'describeTasks', describeTasks)

    const deregisterTaskDefinition = jest
      .fn()
      .mockImplementation((input, callback) => {
        callback(null, {})
      })
    AWSMock.mock('ECS', 'deregisterTaskDefinition', deregisterTaskDefinition)

    const deleteLogStream = jest.fn().mockImplementation((input, callback) => {
      callback(null, {})
    })
    AWSMock.mock('CloudWatchLogs', 'deleteLogStream', deleteLogStream)

    const mockListObjectsResult = mock<
      PromiseResult<S3.ListObjectsV2Output, AWSError>
    >({
      Contents: [
        {
          Key: 'filename'
        }
      ]
    })
    const listObjectsV2 = jest.fn().mockImplementation((input, callback) => {
      callback(null, mockListObjectsResult)
    })

    AWSMock.mock('S3', 'listObjectsV2', listObjectsV2)

    const deleteBucket = jest.fn().mockImplementation((input, callback) => {
      callback(null, {})
    })

    const deleteObject = jest.fn().mockImplementation((input, callback) => {
      callback(null, {})
    })
    AWSMock.mock('S3', 'deleteObject', deleteObject)
    AWSMock.mock('S3', 'deleteBucket', deleteBucket)

    const mockCreateSecurityGroupResponse = mock<
      PromiseResult<EC2.CreateSecurityGroupResult, AWSError>
    >({
      GroupId: `mockedGroupId`
    })
    const createSecurityGroup = jest
      .fn()
      .mockImplementation((input, callback) => {
        callback(null, mockCreateSecurityGroupResponse)
      })

    AWSMock.mock(`EC2`, `createSecurityGroup`, createSecurityGroup)

    const deleteSecurityGroup = jest
      .fn()
      .mockImplementation((input, callback) => {
        return callback(null, {})
      })
    AWSMock.mock(`EC2`, `deleteSecurityGroup`, deleteSecurityGroup)
    return {
      Sut: AWSECSRemoteEnvironment,
      region,
      webIdentityToken,
      roleArn,
      ecsExecutionSettings,
      mockCreateBucketResult,
      mockDescribeTasksResult,
      mockGetLogEventsResult,
      mockRegisterTaskDefinitionResult,
      mockRunTaskResult,
      mockedAwsCredentials,
      mockedCreateClusterResult,
      mockedDescribeClusterResult,
      mockedEcsCluster,
      deregisterTaskDefinition,
      deleteLogStream,
      deleteBucket,
      deleteObject,
      deleteSecurityGroup
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
    }, 10000)

    it('correctly runs the ECS Task, execute the remote code, and return the status, when ECS Cluster already exists', async () => {
      // Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        mockedDescribeClusterResult
      } = makeSut()
      mockedDescribeClusterResult.clusters = [{clusterName: 'existing-cluster'}]
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
    }, 10000)

    it('correctly creates the security group, if no securityGroupId is provided', async () => {
      // Given
      const {Sut, region, roleArn, webIdentityToken, ecsExecutionSettings} =
        makeSut({securityGroupId: ''})
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
    }, 10000)
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
        deleteObject,
        deleteBucket,
        deleteLogStream,
        deregisterTaskDefinition,
        deleteSecurityGroup
      } = makeSut({securityGroupId: ''})
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
      expect(deleteLogStream).toHaveBeenCalled()
      expect(deregisterTaskDefinition).toHaveBeenCalled()
      expect(deleteObject).toHaveBeenCalled()
      expect(deleteBucket).toHaveBeenCalled()
      expect(deleteSecurityGroup).toHaveBeenCalled()
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
})
