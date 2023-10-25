import AWS, {Credentials, ECS} from 'aws-sdk'
import {mock} from 'jest-mock-extended'
import {BucketService} from '../awsServices/BucketService'
import {ContainerService} from '../awsServices/ContainerService'
import {LogStreamingService} from '../awsServices/LogStreamingService'
import {NetworkService} from '../awsServices/NetworkService'
import {ECSExecutionSettings} from './ECSExecutionSettings'
import AWSMock from 'aws-sdk-mock'
import {AWSECSTeardownEnvironment} from './AWSECSTeardownEnvironment'
import {GHALogger} from '../GHALogger'

jest.mock('../awsServices/BucketService')
jest.mock('../awsServices/ContainerService')
jest.mock('../awsServices/LogStreamingService')
jest.mock('../awsServices/NetworkService')
jest.mock('../GHALogger')

describe('AWSECSTeardownEnvironment', () => {
  const makeSut = () => {
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

    const ecsExecutionSettings = mock<ECSExecutionSettings>({
      executionRoleArn: 'executionRoleArn',
      ecsClusterName: 'clustername',
      securityGroupId: 'sg-id',
      uniqueExecutionId: 'uniqueExecutionId',
      vpcId: 'vpc-id'
    })

    const deleteBucket = jest.fn()
    ;(BucketService as jest.Mock).mockImplementation(() => {
      return {
        deleteBucket
      }
    })

    const deleteSecurityGroup = jest.fn()
    const getSecurityGroupIdByname = jest.fn().mockReturnValue('sg-id')
    ;(NetworkService as jest.Mock).mockImplementation(() => {
      return {
        deleteSecurityGroup,
        getSecurityGroupIdByname
      }
    })

    const taskDefinition = mock<ECS.TaskDefinition>()
    const deleteTaskDefinition = jest.fn().mockResolvedValue(taskDefinition)
    const taskId = `some-task-id`
    const task = mock<ECS.Task>({
      lastStatus: 'STOPPED',
      taskArn: `arn:aws:ecs:us-east-1:111111111:task/${ecsExecutionSettings.ecsClusterName}/${taskId}`
    })
    const extractTaskIdFromArn = jest.fn().mockResolvedValue(taskId)
    const stopTask = jest.fn().mockResolvedValue(task)
    const getTaskByExecutionId = jest.fn().mockResolvedValue(task)
    ;(ContainerService as any).mockImplementation(() => {
      return {
        stopTask,
        deleteTaskDefinition,
        getTaskByExecutionId
      }
    })
    ;(ContainerService as any).extractTaskIdFromArn = extractTaskIdFromArn

    const deleteLogStream = jest.fn()
    ;(LogStreamingService as jest.Mock).mockImplementation(() => {
      return {
        deleteLogStream
      }
    })

    const info = jest.fn()
    const debug = jest.fn()
    ;(GHALogger as jest.Mock).mockImplementation(() => {
      return {
        info,
        debug
      }
    })

    return {
      Sut: AWSECSTeardownEnvironment,
      region,
      webIdentityToken,
      roleArn,
      ecsExecutionSettings,
      deleteBucket,
      deleteSecurityGroup,
      getSecurityGroupIdByname,
      extractTaskIdFromArn,
      stopTask,
      deleteTaskDefinition,
      getTaskByExecutionId,
      deleteLogStream,
      info,
      debug,
      task
    }
  }

  describe('tearDown', () => {
    it('should delete the s3 bucket', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteBucket
      } = makeSut()
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })

      //Then
      expect(deleteBucket).toHaveBeenCalled()
    })

    it('should log info when bucket resource does not exists', async () => {
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteBucket,
        info
      } = makeSut()
      deleteBucket.mockRejectedValue({code: 'NoSuchBucket'})
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })

      //Then
      expect(deleteBucket).toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith(
        `Bucket ${ecsExecutionSettings.uniqueExecutionId} does not exist. Ignoring it`
      )
    })

    it('should throw an error for anything other than NoSuchBucket', async () => {
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteBucket
      } = makeSut()
      const exception = new Error('some error')
      deleteBucket.mockRejectedValue(exception)
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      const act = async () => {
        await awsEcsTeardownEnvironment.tearDown({
          settings: ecsExecutionSettings
        })
      }

      //Then
      await expect(act()).rejects.toThrow(exception)
      expect(deleteBucket).toHaveBeenCalledWith({
        bucketName: ecsExecutionSettings.uniqueExecutionId
      })
    })

    it('should get the id and delete the security group if not passed in settings', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        getSecurityGroupIdByname,
        deleteSecurityGroup
      } = makeSut()
      ecsExecutionSettings.securityGroupId = ''
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(getSecurityGroupIdByname).toHaveBeenCalledWith({
        name: ecsExecutionSettings.uniqueExecutionId
      })
      expect(deleteSecurityGroup).toHaveBeenCalled()
    })

    it('should not delete the security group if passed in settings', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteSecurityGroup
      } = makeSut()
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(deleteSecurityGroup).not.toHaveBeenCalled()
    })

    it('should get the task and stop the ecs task if it is not stopped', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        extractTaskIdFromArn,
        stopTask,
        task
      } = makeSut()
      task.lastStatus = 'RUNNING'
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(extractTaskIdFromArn).toHaveBeenCalled()
      expect(stopTask).toHaveBeenCalled()
    })

    it('should return the task if the task is stopped', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        extractTaskIdFromArn,
        stopTask
      } = makeSut()
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(extractTaskIdFromArn).toHaveBeenCalled()
      expect(stopTask).not.toHaveBeenCalled()
    })

    it('should delete the task definition and delete the related logstream', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteTaskDefinition,
        extractTaskIdFromArn,
        deleteLogStream
      } = makeSut()
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(deleteTaskDefinition).toHaveBeenCalled()
      expect(extractTaskIdFromArn).toHaveBeenCalled()
      expect(deleteLogStream).toHaveBeenCalled()
    })

    it('should throw an error for anything other than ResourceNotFoundException', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        deleteTaskDefinition
      } = makeSut()
      const exception = new Error('some error')
      deleteTaskDefinition.mockRejectedValue(exception)
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      const act = async () => {
        await awsEcsTeardownEnvironment.tearDown({
          settings: ecsExecutionSettings
        })
      }
      //Then
      await expect(act()).rejects.toThrow(exception)
      expect(deleteTaskDefinition).toHaveBeenCalled()
    })

    it('should log info if a resource is not found', async () => {
      //Given
      const {
        Sut,
        region,
        roleArn,
        webIdentityToken,
        ecsExecutionSettings,
        info,
        deleteTaskDefinition
      } = makeSut()
      deleteTaskDefinition.mockRejectedValue({
        code: 'ResourceNotFoundException'
      })
      //When
      const awsEcsTeardownEnvironment = await Sut.fromGithubOidc({
        region,
        roleArn,
        webIdentityToken
      })

      await awsEcsTeardownEnvironment.tearDown({
        settings: ecsExecutionSettings
      })
      //Then
      expect(deleteTaskDefinition).toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith(
        `Skipping since resource does not exist`
      )
    })
  })
})
