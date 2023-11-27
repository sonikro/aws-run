<p align="center">
  <a href="https://github.com/sonikro/aws-run/actions"><img alt="aws-run-action status" src="https://github.com/sonikro/aws-run/workflows/build-test/badge.svg"></a>

</p>

[![Open in Dev Containers](https://img.shields.io/static/v1?label=Dev%20Containers&message=Open&color=blue&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/sonikro/aws-run)


# Run code remotely in your AWS Account with GitHub Actions

This action allows you to run a script inside of your AWS Account, without having to spin up your own runner. By leveraging the power of ECS Tasks, you can use any docker image, and run any script inside of your Job, as if that script was being executed inside of the runner, however, the script is remotely executed inside of your AWS VPC, which grants your step special access to private resources, such as RDS Databases, Internal Loadbalancers, and much more.

<!-- start inputs -->

| **Input**                      | **Description**                                                                                                                                                                                                        | **Default**              | **Required** |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------ |
| **`role_arn`**                 | Role ARN to be used to create/execute the required infrastructure on AWS                                                                                                                                               |                          | **true**     |
| **`execution_role_arn`**       | Role ARN to be used to as execution role for the ECS Task that will run the script. Defaults to ROLE_ARN                                                                                                               |                          | **false**    |
| **`task_role_arn`**            | Role ARN to be used as Task Role arn for the ECS Task that will run the script. Defaults to ROLE_ARN                                                                                                                   |                          | **false**    |
| **`memory`**                   | Amount of memory to be used by the remote ECS Task (Must be a FARGATE Compatible combination. See https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)                              | `512`                    | **false**    |
| **`cpu`**                      | Amount of vCPU to be used by the remote ECS Task (Must be a FARGATE Compatible combination. See https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)                                | `256`                    | **false**    |
| **`ecs_cluster_name`**         | The name of the ECS Cluster where the Tasks will run. It will be automatically created if it doesn't exist                                                                                                             | `github-actions-aws-run` | **false**    |
| **`image`**                    | Name of the docker container to be used for the step execution                                                                                                                                                         |                          | **true**     |
| **`region`**                   | AWS Region to execute the operations                                                                                                                                                                                   | `us-east-1`              | **true**     |
| **`security_group_id`**        | Security Group to be used by the ECS Task. If not informed, a temporary security group will be created with access to the internet                                                                                     |                          | **false**    |
| **`run`**                      | Script that will be executed in the remote environment                                                                                                                                                                 |                          | **true**     |
| **`shell`**                    | Name of the shell to be used in the container to execute the run script                                                                                                                                                |                          | **true**     |
| **`subnet_ids`**               | Subnet ID of where the Task will be executed. If no subnet_ids is specified, the task will find one automatically within the VPC                                                                                       |                          | **false**    |
| **`vpc_id`**                   | VPC ID of where the Task will be executed                                                                                                                                                                              |                          | **true**     |
| **`tags`**                     | The list of custom tags to be added to all resources created on AWS with.                                                                                                                                              |                          | **false**    |
| **`polling_interval`**         | The amount of time (in seconds) between polling cloudwatch logs.                                                                                                                                                       | `2`                      | **false**    |
| **`post_complete_log_cycles`** | Number of polling cycles to try getting logs after the ecs task completes.                                                                                                                                             | `4`                      | **false**    |
| **`upload_includes`**          | Array of string paths to include while uploading the runner workspace to the ECS Task. Excludes apply before includes. See https://docs.aws.amazon.com/cli/latest/reference/s3/#use-of-exclude-and-include-filters     |                          | **false**    |
| **`upload_excludes`**          | Array of string paths to exclude while uploading the runner workspace to the ECS Task. Excludes apply before includes. See https://docs.aws.amazon.com/cli/latest/reference/s3/#use-of-exclude-and-include-filters     |                          | **false**    |
| **`download_includes`**        | Array of string paths to include while downloading the runner workspace from the ECS Task. Excludes apply before includes. See https://docs.aws.amazon.com/cli/latest/reference/s3/#use-of-exclude-and-include-filters |                          | **false**    |
| **`download_excludes`**        | Array of string paths to exclude while downloading the runner workspace from the ECS Task. Excludes apply before includes. See https://docs.aws.amazon.com/cli/latest/reference/s3/#use-of-exclude-and-include-filters |                          | **false**    |

<!-- end inputs -->

## Benefits

- Use IaC (such as Terraform) to manipulate resources that are in Private VPCs (such as RDS, Opensearch, etc)
- Run automated tests against services that are not exposed to the internet
- Control the size of the container that will execute your step, by controlling the vCPU and Memory of your container
- Pick whic VPC/Subnet you want your Task to run
- Tasks are ephemeral and all resources created to run the task are teared down by the end, making it the ultimate ephemeral task
- Don't worry about setting up your own runners inside your VPC anymore, as you can use any runner with access to the internet to remotely execute code within your AWS Environment
- Seamlessly share files back and forth between your GH Runner and your ECS Task

## Getting Started

To get started with the **aws-run** action, here are the minimum requirements:

- [Your AWS Account is setup to accept OIDC Tokens from GitHub Actions](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- You have at least 1 IAM Role with all the required permissions to execute the remote task.

### IAM Role example

Your IAM Role needs to allow both the GitHub OIDC Server, and the *ecs-tasks.amazonaws.com* as principals to assume it.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::<YOUR_ACCOUNT_NUMBER>:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:<YOUR_ORG>/<YOUR_REPOSITORY>:*"
                }
            }
        },
        {
            "Sid": "",
            "Effect": "Allow",
            "Principal": {
                "Service": "ecs-tasks.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
```

### IAM Policy Example

The policy attattched to this role must have at least these permissions:

```json
{
    "Statement": [
        {
            "Action": [
                "ec2:CreateSecurityGroup",
                "ec2:CreateTags",
                "ecs:DeregisterTaskDefinition",
                "ecs:RegisterTaskDefinition",
                "ecs:DescribeTasks",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "s3:CreateBucket",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSubnets"
            ],
            "Effect": "Allow",
            "Resource": [
                "*"
            ]
        },
        {
            "Action": [
                "iam:PassRole"
            ],
            "Effect": "Allow",
            "Resource": [
                "arn:aws:iam::ACCOUNT_NUMBER:role/*aws-run*"
            ]
        },
        {
            "Action": [
                "ecs:DeleteTaskDefinitions",
                "ecs:DeregisterContainerInstance",
                "ecs:RegisterContainerInstance",
                "ecs:RunTask",
                "ecs:DescribeClusters"
            ],
            "Effect": "Allow",
            "Resource": [
                "arn:aws:ecs:*:ACCOUNT_NUMBER:*/*aws-run*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "ecs:StopTask",
                "ecs:ListTasks"
            ],
            "Resource": [
                "*"
            ],
            "Condition": {
                "StringLike": {
                    "ecs:cluster": [
                        "arn:aws:ecs:*:ACCOUNT_NUMBER:cluster/github-actions-aws-run"
                    ]
                }
            }
        },
        {
            "Action": [
                "logs:DeleteLogStream",
                "logs:Get*"
            ],
            "Effect": "Allow",
            "Resource": [
                "arn:aws:logs:*:ACCOUNT_NUMBER:log-group:*aws-run*"
            ]
        },
        {
            "Action": [
                "s3:*"
            ],
            "Effect": "Allow",
            "Resource": [
                "arn:aws:s3:::*aws-run*"
            ]
        },
        {
            "Action": [
                "ec2:DeleteSecurityGroup"
            ],
            "Effect": "Allow",
            "Resource": "*"
        }
    ],
    "Version": "2012-10-17"
}
```
### Usage in your workflow

#### Easiest way to get started

```yaml
jobs:
  terraform: 
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write 
    steps:
      - uses: actions/checkout@v3

      - uses: sonikro/aws-run@v1
        with:
          role_arn: "${{secrets.ROLE_ARN}}"
          image: hashicorp/terraform:latest
          region: us-east-1
          vpc_id: "${{secrets.VPC_ID}}"
          shell: sh
          run: |
            terraform apply
```

#### Specifying a custom security group id

If you don't want the action to create a temporary security-group for the remote execution (the security group blocks all incoming traffic and allows all outgoing traffic), you must specify the **security_group_id** argument

```yaml
jobs:
  terraform: 
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write 
    steps:
      - uses: actions/checkout@v3

      - uses: sonikro/aws-run@v1
        with:
          role_arn: "${{secrets.ROLE_ARN}}"
          image: hashicorp/terraform:latest
          region: us-east-1
          vpc_id: "${{secrets.VPC_ID}}"
          subnet_ids: |
            ${{secrets.SUBNBET_ID}}
          security_group_id: "<SECURITY_GROUP_ID>"
          shell: sh
          run: |
            terraform apply
```

#### Using specific subnet ids

If you want your task to run on specific subnets, use the **subnet_ids** argument

```yaml
jobs:
  terraform: 
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write 
    steps:
      - uses: actions/checkout@v3

      - uses: sonikro/aws-run@v1
        with:
          role_arn: "${{secrets.ROLE_ARN}}"
          image: hashicorp/terraform:latest
          region: us-east-1
          vpc_id: "${{secrets.VPC_ID}}"
          security_group_id: "<SECURITY_GROUP_ID>"
          subnet_ids: |
            ${{secrets.SUBNBET_ID}}
          shell: sh
          run: |
            terraform apply
```

> id-token: write is required in order to authenticate to AWS using OIDC

This example would run a container with image **hashicorp/terraform:latest** in your AWS Account, connected to the specified VPC_ID, SUBNET_ID nd SECURITY_GROUP_ID. All contents of the GitHub Runner Workspace are copied to the remote container, meaning that the remote shell has access to all of the files of the host runner.

## Understanding what happens

This action will essentially work in 3 steps

### Setup

The setup step makes sure that your account has the minimum required AWS Resources to run your script. That includes:

- Creating a fargete compatible ECS Cluster, if it doesn't exist yet
- Uploading your workspace files into a private S3 Bucket (which only the ROLE_ARN you specify will have access to)
### Execution

In the execution phase, the action will:

- Create a Task Definition to run your Task
- Run the Task based on the Task Definition
- The Task uses a Sidecar container to inject the contents of the workspace (uploaded on the Setup stage), into your main container
- It runs your script, using the specified **shell** (make sure the image you are using, has the shell you selected)
- It waits for the ECS Task to complete.
- It fetches the exitCode of the ECS Task, and use it to determine if the Action should Fail or Succeed
- All logs are streamed to a Cloudwatch Logstream. These logs are then fetched and displayed on GHA (so you don't have to go to AWS Console to see the execution logs)
- Any file changes made in the ECS Task will be synced back to the GitHub Runner

### Teardown

- The Task Definition is deleted
- The S3 Bucket that stored the runner workspace data is deleted
- Cloudwatch Logstreams are deleted

> Currently the ECS Cluster is not deleted, as it can be reused with no additional cost.

## TO-DO

- [ ] Come up with a more restrictive IAM Policy Example
- [X] Add more parameters to allow customizing the CPU and Memory of the container 
- [X] Delete the Cloudwatch Logstream on Teardown
- [X] Allow multiple Subnet IDs
- [X] Stream the Cloudwatch logs as they happen, and not just at the end of the execution
- [X] Automatically create temporary security group if one is not provided
- [X] Automatically grab list of Subnets for VPC_ID, if Subnet_IDS are not provided
- [ ] Mask secrets inside the Cloudwatch Logs
- [X] Map all GitHub Contexts/ENVS into the ECS Container
- [X] Ability to upload artifacts back to GitHub (if your remote execution generates artifacts)
- [ ] Find a way to map environment variables from the remote shell, back to the runner (after execution)
- [X] Change the TearDown step to run as a **post** action on GHA, so take advantages of errors/cancellations
- [ ] Make it compatible with [Windows Containers](https://aws.amazon.com/blogs/containers/running-windows-containers-with-amazon-ecs-on-aws-fargate/)

## Developing the action locally


Install the dependencies  
```bash
$ npm install
```

Build the typescript and package it for distribution
```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:  
```bash
$ npm test
```

Demo changes