import {S3} from 'aws-sdk'
import S3SyncClient, {Filter} from 's3-sync-client'
import {Logger} from '../../core/provider/Logger'
import {Tags} from './SharedTypes'
import {DeletableResource} from '../../core/domain/DeletableResource'
import {ObjectList} from 'aws-sdk/clients/s3'
import {minimatch} from 'minimatch'
import fs from 'fs'

export interface BucketServiceDependencies {
  s3: S3
  s3SyncClient: S3SyncClient
  logger: Logger
}

export interface BucketSettings {
  bucketName: string
  accessRoleArn: string
  runnerWorkspaceFolder: string
}

export interface BucketResource extends DeletableResource {
  bucketName: string
}

export class BucketService {
  constructor(private readonly dependencies: BucketServiceDependencies) {}

  async createBucket(args: {
    bucketName: string
    accessRoleArn: string
    tags: Tags
  }): Promise<BucketResource> {
    const {s3, logger} = this.dependencies
    const {accessRoleArn, bucketName, tags} = args

    const bucket = await s3
      .createBucket({
        Bucket: bucketName,
        ACL: 'private'
      })
      .promise()

    logger.debug(`Created bucket ${bucket.Location!}`)

    await s3
      .putBucketTagging({
        Bucket: bucketName,
        Tagging: {
          TagSet: this.toS3Tags(tags)
        }
      })
      .promise()

    await s3
      .putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                AWS: accessRoleArn
              },
              Action: 's3:*',
              Resource: [
                `arn:aws:s3:::${bucketName}`,
                `arn:aws:s3:::${bucketName}/*`
              ]
            }
          ]
        })
      })
      .promise()

    return {
      bucketName,
      tearDown: async () => await this.deleteBucket({bucketName})
    }
  }

  /**
   * Uploads the content of a local directory into S3
   */
  async syncUp({
    localWorkspacePath,
    bucketName,
    excludes,
    includes
  }: {
    localWorkspacePath: string
    bucketName: string
    includes: string[]
    excludes: string[]
  }): Promise<void> {
    const {s3SyncClient} = this.dependencies
    const filters = this.toS3Filters({excludes, includes})
    await s3SyncClient.sync(localWorkspacePath, bucketName, {
      filters
    })
  }

  /**
   * Download resources from S3 Bucket, down into a local directory
   */
  async syncDown({
    localWorkspacePath,
    bucketName,
    includes,
    excludes
  }: {
    localWorkspacePath: string
    bucketName: string
    includes: string[]
    excludes: string[]
  }): Promise<void> {
    const {s3SyncClient} = this.dependencies
    await s3SyncClient.sync(bucketName, localWorkspacePath, {
      filters: [
        ...this.toS3Filters({excludes, includes}),
        {exclude: key => key.startsWith('.git/')}
      ]
    })
  }

  async deleteBucket({bucketName}: {bucketName: string}): Promise<void> {
    const {s3, logger} = this.dependencies
    const allObjects = await this.fetchAllObjects({bucketName})

    await Promise.all(
      allObjects.map(
        async content =>
          await s3
            .deleteObject({Bucket: bucketName, Key: content.Key!})
            .promise()
      )
    )

    await s3.deleteBucket({Bucket: bucketName}).promise()

    logger.debug(`Bucket ${bucketName} deleted successfully`)
  }

  /**
   * Fetches all objects from the bucket with pagination
   */
  private async fetchAllObjects({
    bucketName
  }: {
    bucketName: string
  }): Promise<ObjectList> {
    const {s3} = this.dependencies

    let nextToken: string | undefined
    const objectList: ObjectList = []
    do {
      const listResponse = await s3
        .listObjectsV2({Bucket: bucketName, ContinuationToken: nextToken})
        .promise()
      objectList.push(...(listResponse.Contents || []))
      nextToken = listResponse.NextContinuationToken
    } while (nextToken)

    return objectList
  }

  private toS3Tags(tags: Tags): S3.TagSet {
    return Object.keys(tags).map(key => ({
      Key: key,
      Value: tags[key]
    }))
  }

  private isDirectory(path: string): boolean {
    try {
      return fs.lstatSync(path).isDirectory()
    } catch (e) {
      return false
    }
  }

  private toS3Filters({
    excludes,
    includes
  }: {
    includes: string[]
    excludes: string[]
  }): Filter[] {
    const adjustedExcludeKeys = excludes.map(x => {
      const result = this.isDirectory(x) ? `${x}/**` : x
      return result
    })

    const adjustedIncludeKeys = includes.map(x => {
      const result = this.isDirectory(x) ? `${x}/**` : x
      return result
    })

    const excludeFilters = {
      exclude: (key: string) =>
        adjustedExcludeKeys.some(adjustedKey => {
          return minimatch(key, adjustedKey, {dot: true})
        })
    }
    const includeFilters = {
      include: (key: string) =>
        adjustedIncludeKeys.some(adjustedKey => {
          return minimatch(key, adjustedKey, {dot: true})
        })
    }
    return [excludeFilters, includeFilters]
  }
}
