<p align="center">
  <a href="https://github.com/sonikro/aws-run/actions"><img alt="aws-run-action status" src="https://github.com/sonikro/aws-run/workflows/build-test/badge.svg"></a>
</p>

# Run code remotely in your AWS Account with GitHub Actions

This action allows you to run a script inside of your AWS Account, without having to spin up your own runner. By leveraging the power of ECS Tasks, you can use any docker image, and run any script inside of your Job, as if that script was being executed inside of the runner, however, the script is remotely executed inside of your AWS VPC, which grants your step special access to private resources, such as RDS Databases, Internal Loadbalancers, and much more.

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
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": [
                "ecs:DescribeClusters",
                "ecs:DeregisterTaskDefinition",
                "ecs:UpdateCluster",
                "ecs:RunTask",
                "ecs:ExecuteCommand",
                "ecs:CreateCluster",
                "ecs:RegisterTaskDefinition",
                "ecs:DeleteCluster",
                "ecs:StopTask",
                "ecs:DeleteTaskDefinitions",
                "ecs:TagResource",
                "ecs:UntagResource",
                "ecs:ListTaskDefinitions",
                "ecs:ListClusters",
                "ecs:ListTasks",
                "ecs:DescribeTaskDefinition",
                "ecs:DescribeTasks",
                "iam:PassRole",
                "logs:CreateLogGroup",
                "logs:GetLogEvents",
                "s3:*",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSecurityGroupRules",
                "ec2:AuthorizeSecurityGroupEgress",
                "ec2:CreateSecurityGroup",
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:DeleteSecurityGroup",
          			"ec2:DescribeSubnets"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DeleteLogStream"
            ],
            "Resource": "*"
        }
    ]
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
- [ ] Change the TearDown step to run as a **post** action on GHA, so take advantages of errors/cancellations
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
