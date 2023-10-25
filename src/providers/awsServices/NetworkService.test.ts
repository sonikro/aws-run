import AWSMock from 'aws-sdk-mock'
import AWS, {EC2} from 'aws-sdk'
import {mock} from 'jest-mock-extended'
import {NetworkService} from './NetworkService'

describe('NetworkService', () => {
  const makeSut = () => {
    AWSMock.setSDKInstance(AWS)

    const mockSubnets = mock<EC2.DescribeSubnetsResult>({
      Subnets: [{SubnetId: 'subnet1'}, {SubnetId: 'subnet2'}]
    })
    const describeSubnets = jest.fn().mockImplementation((_, callback) => {
      callback(null, mockSubnets)
    })
    AWSMock.mock('EC2', 'describeSubnets', describeSubnets)

    const mockSecurityGroup = mock<EC2.CreateSecurityGroupResult>({
      GroupId: 'sg-1'
    })
    const createSecurityGroup = jest.fn().mockImplementation((_, callback) => {
      callback(null, mockSecurityGroup)
    })
    AWSMock.mock('EC2', 'createSecurityGroup', createSecurityGroup)

    const deleteSecurityGroup = jest.fn().mockImplementation((_, callback) => {
      callback(null, {})
    })
    AWSMock.mock('EC2', 'deleteSecurityGroup', deleteSecurityGroup)
    const securityGroupId = 'sg-1'
    const securityGroupName = 'sg-name'

    const describeSecurityGroupsResponse =
      mock<EC2.DescribeSecurityGroupsResult>({
        SecurityGroups: [{GroupId: securityGroupId}]
      })
    const describeSecurityGroups = jest
      .fn()
      .mockImplementation((_, callback) => {
        callback(null, describeSecurityGroupsResponse)
      })
    AWSMock.mock('EC2', 'describeSecurityGroups', describeSecurityGroups)

    const networkService = new NetworkService({ec2: new EC2()})
    const vpcId = 'vpc-id-1'

    return {
      sut: networkService,
      mockSubnets,
      vpcId,
      mockSecurityGroup,
      deleteSecurityGroup,
      securityGroupId,
      securityGroupName
    }
  }

  afterEach(() => {
    AWSMock.restore()
  })

  describe('findSubnetIds', () => {
    it('returns the subnetIds if they are provided', async () => {
      // Given
      const {sut, vpcId} = makeSut()
      const expectedSubnetIds = ['subnet1']
      // When
      const actualSubnetIds = await sut.findSubnetIds({
        vpcId: vpcId,
        subnetIds: expectedSubnetIds
      })
      // Then
      expect(actualSubnetIds).toStrictEqual(expectedSubnetIds)
    })
    it('finds all subnets for the vpcId provided', async () => {
      // Given
      const {sut, mockSubnets, vpcId} = makeSut()
      const expectedSubnetIds = mockSubnets.Subnets!.map(
        subnet => subnet.SubnetId
      )
      // When
      const actualSubnetIds = await sut.findSubnetIds({
        vpcId: vpcId,
        subnetIds: []
      })
      // Then
      expect(actualSubnetIds).toStrictEqual(expectedSubnetIds)
    })
  })

  describe('getOrCreateSecurityGroup', () => {
    it('returns the security group id if the id is provided, and a tearDown function', async () => {
      // Given
      const {
        sut,
        vpcId,
        mockSecurityGroup,
        securityGroupId,
        deleteSecurityGroup
      } = makeSut()
      // When
      const actualSecurityGroup = await sut.getOrCreateSecurityGroup({
        securityGroupId: securityGroupId,
        name: 'security-group',
        tags: {'test-key': 'test-value'},
        vpcId: vpcId
      })
      await actualSecurityGroup.tearDown()
      // Then
      expect(actualSecurityGroup.securityGroupId).toBe(securityGroupId)
      expect(deleteSecurityGroup).not.toHaveBeenCalled()
    })
    it('creates a security group when none are provided, and a tearDown function', async () => {
      // Given
      const {sut, vpcId, mockSecurityGroup, deleteSecurityGroup} = makeSut()
      const expectedSecurityGroupId = mockSecurityGroup.GroupId
      // When
      const actualSecurityGroup = await sut.getOrCreateSecurityGroup({
        securityGroupId: '',
        name: 'security-group',
        tags: {'test-key': 'test-value'},
        vpcId: vpcId
      })
      await actualSecurityGroup.tearDown()
      // Then
      expect(actualSecurityGroup.securityGroupId).toBe(expectedSecurityGroupId)
      expect(deleteSecurityGroup).toHaveBeenCalled()
    })
  })

  describe('getSecurityGroupIdByname', () => {
    it('finds a security id by name', async () => {
      // Given
      const {sut, securityGroupId, securityGroupName} = makeSut()
      // When
      const actualSgId = await sut.getSecurityGroupIdByname({
        name: securityGroupName
      })
      // Then
      expect(actualSgId).toBe(securityGroupId)
    })
  })

  describe('deleteSecurityGroup', () => {
    it('deletes the security group', async () => {
      // Given
      const {sut, deleteSecurityGroup, securityGroupId} = makeSut()
      // When
      await sut.deleteSecurityGroup({securityGroupId: securityGroupId})
      // Then
      expect(deleteSecurityGroup.mock.calls[0][0]).toMatchObject({
        GroupId: securityGroupId
      })
    })
  })
})
