import {EC2} from 'aws-sdk'
import {Tags} from './SharedTypes'
import {DeletableResource} from '../../core/domain/DeletableResource'

export interface NetworkServiceDependencies {
  ec2: EC2
}

export interface SecurityGroupResource extends DeletableResource {
  securityGroupId: string
}

export class NetworkService {
  constructor(private readonly dependencies: NetworkServiceDependencies) {}

  async findSubnetIds({
    vpcId,
    subnetIds
  }: {
    vpcId: string
    subnetIds: string[]
  }): Promise<string[]> {
    const {ec2} = this.dependencies
    if (subnetIds.length > 0) {
      return subnetIds
    }
    const allSubnets = await ec2
      .describeSubnets({
        Filters: [
          {
            Name: 'vpc-id',
            Values: [vpcId]
          }
        ]
      })
      .promise()

    return allSubnets.Subnets!.map(it => it.SubnetId!)
  }

  async getOrCreateSecurityGroup({
    securityGroupId,
    name,
    tags,
    vpcId
  }: {
    securityGroupId: string
    vpcId: string
    name: string
    tags: Tags
  }): Promise<SecurityGroupResource> {
    const {ec2} = this.dependencies
    if (securityGroupId !== '') {
      return {
        securityGroupId,
        tearDown: async () => Promise.resolve() // Nothing to delete
      }
    }
    const newSecurityGroup = await ec2
      .createSecurityGroup({
        GroupName: name,
        Description: `Temporary security group for aws-run container`,
        VpcId: vpcId,
        TagSpecifications: [
          {
            Tags: this.toEc2Tags(tags),
            ResourceType: 'security-group'
          }
        ]
      })
      .promise()
    return {
      securityGroupId: newSecurityGroup.GroupId!,
      tearDown: async () =>
        await this.deleteSecurityGroup({
          securityGroupId: newSecurityGroup.GroupId!
        })
    }
  }

  async getSecurityGroupIdByname({
    name
  }: {
    name: string
  }): Promise<string | undefined> {
    const {ec2} = this.dependencies

    const sgs = await ec2
      .describeSecurityGroups({
        Filters: [
          {
            Name: 'group-name',
            Values: [name]
          }
        ]
      })
      .promise()

    return sgs.SecurityGroups?.[0]?.GroupId
  }

  async deleteSecurityGroup({
    securityGroupId
  }: {
    securityGroupId: string
  }): Promise<void> {
    const {ec2} = this.dependencies
    await ec2.deleteSecurityGroup({GroupId: securityGroupId}).promise()
  }

  private toEc2Tags(tags: Tags): EC2.TagList {
    return Object.keys(tags).map(key => ({
      Key: key,
      Value: tags[key]
    }))
  }
}
