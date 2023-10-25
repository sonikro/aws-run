import {S3Client} from '@aws-sdk/client-s3'
import AWS, {S3} from 'aws-sdk'
import AWSMock from 'aws-sdk-mock'
import {mock} from 'jest-mock-extended'
import S3SyncClient, {Filter} from 's3-sync-client'
import {GHALogger} from '../GHALogger'
import {BucketService} from './BucketService'
import fs, {StatsBase} from 'fs'

jest.mock('s3-sync-client')

describe('BucketService', () => {
  const makeSut = () => {
    AWSMock.setSDKInstance(AWS)

    const mockBucket = mock<S3.CreateBucketOutput>({
      Location: 'bucket1'
    })
    const createBucket = jest.fn().mockImplementation((_, callback) => {
      callback(null, mockBucket)
    })
    AWSMock.mock('S3', 'createBucket', createBucket)

    const putBucketTagging = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('S3', 'putBucketTagging', putBucketTagging)

    const putBucketPolicy = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('S3', 'putBucketPolicy', putBucketPolicy)

    const mockObjects = mock<S3.ListObjectsV2Output>({
      Contents: [{Key: 'some-key'}],
      NextContinuationToken: undefined
    })
    const listObjects = jest.fn().mockImplementation((_, callback) => {
      callback(null, mockObjects)
    })
    AWSMock.mock('S3', 'listObjectsV2', listObjects)

    const mockObject = mock<S3.DeleteObjectOutput>({
      DeleteMarker: false,
      VersionId: 'some-version-id',
      RequestCharged: 'some-request-charged'
    })
    const deleteObject = jest.fn().mockImplementation((_, callback) => {
      callback(null, mockObject)
    })
    AWSMock.mock('S3', 'deleteObject', deleteObject)

    const deleteBucket = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('S3', 'deleteBucket', deleteBucket)

    const s3Sync = jest.fn().mockImplementation()
    ;(S3SyncClient as jest.Mock).mockImplementation(() => {
      return {
        sync: s3Sync
      }
    })

    const mockIsDirectory = jest.fn().mockImplementation(() => {
      return false
    })
    const mocklstatSync = jest.spyOn(fs, 'lstatSync')
    mocklstatSync.mockImplementation((path, options) => {
      return {
        isDirectory: mockIsDirectory
      } as unknown as StatsBase<number>
    })

    const bucketService = new BucketService({
      s3: new S3(),
      s3SyncClient: new S3SyncClient({client: new S3Client({})}),
      logger: new GHALogger()
    })

    return {
      sut: bucketService,
      deleteBucket,
      s3Sync,
      putBucketTagging,
      listObjects,
      mockObjects,
      mockIsDirectory
    }
  }

  afterEach(() => {
    AWSMock.restore()
    jest.resetAllMocks()
  })

  describe('createBucket', () => {
    it('should create a bucket with tags and a policy, and a tearDown function', async () => {
      //Given
      const {sut, deleteBucket, putBucketTagging} = makeSut()
      const expectedBucketName = 'bucket1'
      const expectedTags: S3.TagSet = [{Key: 'test-key', Value: 'test-value'}]
      //When
      const actualLocation = await sut.createBucket({
        bucketName: expectedBucketName,
        accessRoleArn: 'some-arn',
        tags: {[expectedTags![0].Key]: expectedTags![0].Value}
      })
      await actualLocation.tearDown()
      //Then
      expect(actualLocation.bucketName).toBe(expectedBucketName)
      expect(putBucketTagging.mock.calls[0][0].Tagging.TagSet).toMatchObject(
        expectedTags
      )
      expect(deleteBucket).toHaveBeenCalled()
    })
  })

  describe('syncUp', () => {
    it('should upload workspace to bucket', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncUp({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: [],
        includes: ['*.txt', '**/*.json']
      })

      //Then
      expect(s3Sync.mock.calls[0][0]).toBe(`some-path`)
      expect(s3Sync.mock.calls[0][1]).toBe(`some-bucket`)
    })

    it('should include files that match the paths provided by the user', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncUp({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: [],
        includes: ['*.txt', '**/*.json']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![1].include!('fake.txt')).toBeTruthy()
      expect(receivedFilters![1].include!('fake.json')).toBeTruthy()
      expect(receivedFilters![1].include!('unrelated_file.py')).toBeFalsy()
      expect(receivedFilters![1].include!('some_dir/fake.txt')).toBeFalsy()
      expect(receivedFilters![1].include!('some_dir/fake.json')).toBeTruthy()
    })

    it('should exclude files that match the paths provided by the user', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncUp({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['*.txt', '**/*.json'],
        includes: []
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![0].exclude!('fake.txt')).toBeTruthy()
      expect(receivedFilters![0].exclude!('fake.json')).toBeTruthy()
      expect(receivedFilters![0].exclude!('unrelated_file.py')).toBeFalsy()
      expect(receivedFilters![0].exclude!('some_dir/fake.txt')).toBeFalsy()
      expect(receivedFilters![0].exclude!('some_dir/fake.json')).toBeTruthy()
    })

    it('should apply excludes before includes', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncUp({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['*'],
        includes: ['**/*.json']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![0].hasOwnProperty('exclude')).toBeTruthy()
      expect(receivedFilters![0].hasOwnProperty('include')).toBeFalsy()
      expect(receivedFilters![1].hasOwnProperty('exclude')).toBeFalsy()
      expect(receivedFilters![1].hasOwnProperty('include')).toBeTruthy()
    })

    it('should append ** to filters that are directories', async () => {
      //Given
      const {sut, s3Sync, mockIsDirectory} = makeSut()
      mockIsDirectory.mockReturnValue(true)

      //When
      await sut.syncUp({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['exclude-dir'],
        includes: ['include-dir']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters

      expect(receivedFilters![0].exclude!('exclude-dir')).toBeFalsy() // This says it would copy up the directory, but not any files in it
      expect(receivedFilters![0].exclude!('exclude-dir/some_file')).toBeTruthy()
      expect(
        receivedFilters![0].exclude!('exclude-dir/.some_hidden_file')
      ).toBeTruthy()

      expect(receivedFilters![1].include!('include-dir')).toBeFalsy()
      expect(receivedFilters![1].include!('include-dir/some_file')).toBeTruthy()
      expect(
        receivedFilters![1].include!('include-dir/.some_hidden_file')
      ).toBeTruthy()
    })
  })

  describe('syncDown', () => {
    it('should download bucket to workspace', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: [],
        includes: ['*.txt', '**/*.json']
      })

      //Then
      expect(s3Sync.mock.calls[0][0]).toBe(`some-bucket`)
      expect(s3Sync.mock.calls[0][1]).toBe(`some-path`)
    })

    it('should include files that match the paths provided by the user', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: [],
        includes: ['*.txt', '**/*.json']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![1].include!('fake.txt')).toBeTruthy()
      expect(receivedFilters![1].include!('fake.json')).toBeTruthy()
      expect(receivedFilters![1].include!('unrelated_file.py')).toBeFalsy()
      expect(receivedFilters![1].include!('some_dir/fake.txt')).toBeFalsy()
      expect(receivedFilters![1].include!('some_dir/fake.json')).toBeTruthy()
    })

    it('should exclude files that match the paths provided by the user', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['*.txt', '**/*.json'],
        includes: []
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![0].exclude!('fake.txt')).toBeTruthy()
      expect(receivedFilters![0].exclude!('fake.json')).toBeTruthy()
      expect(receivedFilters![0].exclude!('unrelated_file.py')).toBeFalsy()
      expect(receivedFilters![0].exclude!('some_dir/fake.txt')).toBeFalsy()
      expect(receivedFilters![0].exclude!('some_dir/fake.json')).toBeTruthy()
    })

    it('should apply excludes before includes', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['*'],
        includes: ['**/*.json']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![0].hasOwnProperty('exclude')).toBeTruthy()
      expect(receivedFilters![0].hasOwnProperty('include')).toBeFalsy()
      expect(receivedFilters![1].hasOwnProperty('exclude')).toBeFalsy()
      expect(receivedFilters![1].hasOwnProperty('include')).toBeTruthy()
    })

    it('should append ** to filters that are directories', async () => {
      //Given
      const {sut, s3Sync, mockIsDirectory} = makeSut()
      mockIsDirectory.mockReturnValue(true)

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: ['exclude-dir'],
        includes: ['include-dir']
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters

      expect(receivedFilters![0].exclude!('exclude-dir')).toBeFalsy() // This says it would copy up the directory, but not any files in it
      expect(receivedFilters![0].exclude!('exclude-dir/some_file')).toBeTruthy()
      expect(
        receivedFilters![0].exclude!('exclude-dir/.some_hidden_file')
      ).toBeTruthy()

      expect(receivedFilters![1].include!('include-dir')).toBeFalsy()
      expect(receivedFilters![1].include!('include-dir/some_file')).toBeTruthy()
      expect(
        receivedFilters![1].include!('include-dir/.some_hidden_file')
      ).toBeTruthy()
    })

    it('should not sync down git files by default', async () => {
      //Given
      const {sut, s3Sync} = makeSut()
      jest.spyOn(fs, 'mkdirSync')

      //When
      await sut.syncDown({
        localWorkspacePath: 'some-path',
        bucketName: 'some-bucket',
        excludes: [],
        includes: []
      })

      //Then
      const receivedFilters: Filter[] = s3Sync.mock.calls[0][2].filters
      expect(receivedFilters![2].exclude!('.git/')).toBeTruthy()
      expect(
        receivedFilters![2].exclude!('.git/some_nested_file.txt')
      ).toBeTruthy()
    })
  })

  describe('deleteBucket', () => {
    it('should delete the s3 bucket', async () => {
      //Given
      const {sut, deleteBucket} = makeSut()
      const bucketName = 'bucket1'
      //When
      await sut.deleteBucket({bucketName: bucketName})
      //Then
      expect(deleteBucket.mock.calls[0][0]).toMatchObject({Bucket: bucketName})
    })

    it('should delete the s3 bucket when the bucket has more than one page of objects', async () => {
      //Given
      const {sut, deleteBucket, listObjects, mockObjects} = makeSut()
      const bucketName = 'bucket1'

      const expectedFirstPage = mock<S3.ListObjectsV2Output>({
        Contents: [{Key: 'some-key'}],
        NextContinuationToken: 'someContinuationkey'
      })
      const expectedSecondPage = mockObjects

      listObjects
        .mockImplementationOnce((_, callback) => {
          callback(null, expectedFirstPage)
        })
        .mockImplementationOnce((_, callback) => {
          callback(null, expectedSecondPage)
        })
      //When
      await sut.deleteBucket({bucketName: bucketName})
      //Then
      expect(listObjects).toHaveBeenCalledTimes(2)
      expect(deleteBucket.mock.calls[0][0]).toMatchObject({Bucket: bucketName})
    })
  })
})
