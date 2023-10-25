import {ExecutionSettings} from '../../core/provider/RemoteEnvironment'
import {Tags} from '../awsServices/SharedTypes'

export interface ECSExecutionSettings extends ExecutionSettings {
  vpcId: string
  subnetIds: string[]
  uniqueExecutionId: string
  executionRoleArn: string
  taskRoleArn: string
  shell: string
  securityGroupId: string
  memory: string
  cpu: string
  ecsClusterName: string
  runnerWorkspaceFolder: string
  tags: Tags
  pollingInterval: number
  postCompleteLogCycles: number
  uploadIncludes: string[]
  uploadExcludes: string[]
  downloadIncludes: string[]
  downloadExcludes: string[]
}
