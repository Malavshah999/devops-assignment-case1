# Case 1 — Serverless Dockerized Service

## Overview

A secure, containerized application deployed on AWS ECS Fargate behind an Application Load Balancer and CloudFront CDN. The container runs in a private subnet and is never directly accessible from the internet.

---

## Architecture

```
Internet
   |
   v
CloudFront CDN  (Global Edge — HTTPS, caching)
   |
   v
Application Load Balancer  (Public Subnet — ap-south-1a / ap-south-1b)
   |
   v
ECS Fargate Container  (Private Subnet — 10.0.1.0/24)
   |
   v
Amazon ECR  (Docker image registry)
```

**Network Layout:**

| Subnet | CIDR | Contains |
|---|---|---|
| Public Subnet 1 | 10.0.2.0/24 | ALB, NAT Gateway |
| Public Subnet 2 | 10.0.3.0/24 | ALB (second AZ) |
| Private Subnet | 10.0.1.0/24 | ECS Fargate tasks |

---

## Prerequisites

- **Git** v2.44+ — https://git-scm.com/download/win
- **Node.js** v20.x LTS — https://nodejs.org
- **Docker Desktop** v4.29+ — https://docker.com/products/docker-desktop
- **AWS CLI** v2 — https://awscli.amazonaws.com/AWSCLIV2.msi
- **AWS Account** with the following IAM policies attached to your user:
  - AmazonEC2ContainerRegistryFullAccess
  - AmazonECS_FullAccess
  - AmazonVPCFullAccess
  - ElasticLoadBalancingFullAccess
  - CloudFrontFullAccess
  - CloudWatchFullAccess

---

## Application Endpoints

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/health` | GET | No | Health check — returns `{"status":"ok"}` |
| `/login` | POST | No | Returns JWT token on valid credentials |

**Mock credentials for testing:**
- Username: `admin`
- Password: `password123`

---

## Step-by-Step Deployment

### Step 1 — Clone the Repository

```bash
git clone https://github.com/Malavshah999/devops-assignment-case1.git
cd devops-assignment-case1/case1/app
```

### Step 2 — Install Dependencies

```bash
npm install
```

### Step 3 — Run Locally (Optional Test)

```bash
docker build -t myapp:local .
docker run -p 3000:3000 -e JWT_SECRET=testsecret myapp:local
```

Visit `http://localhost:3000/health` — should return `{"status":"ok"}`

### Step 4 — Configure AWS CLI

```bash
aws configure
# Enter your Access Key ID, Secret Access Key, Region: ap-south-1, Output: json
```

### Step 5 — Create VPC and Networking

```bash
# Create VPC
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --region ap-south-1 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=devops-vpc}]'

# Create subnets (replace VPC_ID with your VPC ID)
aws ec2 create-subnet --vpc-id VPC_ID --cidr-block 10.0.1.0/24 --availability-zone ap-south-1a --region ap-south-1
aws ec2 create-subnet --vpc-id VPC_ID --cidr-block 10.0.2.0/24 --availability-zone ap-south-1a --region ap-south-1
aws ec2 create-subnet --vpc-id VPC_ID --cidr-block 10.0.3.0/24 --availability-zone ap-south-1b --region ap-south-1

# Create and attach Internet Gateway
aws ec2 create-internet-gateway --region ap-south-1
aws ec2 attach-internet-gateway --internet-gateway-id IGW_ID --vpc-id VPC_ID --region ap-south-1

# Enable DNS on VPC
aws ec2 modify-vpc-attribute --vpc-id VPC_ID --enable-dns-support --region ap-south-1
aws ec2 modify-vpc-attribute --vpc-id VPC_ID --enable-dns-hostnames --region ap-south-1

# Create public route table and add internet route
aws ec2 create-route-table --vpc-id VPC_ID --region ap-south-1
aws ec2 create-route --route-table-id RTB_ID --destination-cidr-block 0.0.0.0/0 --gateway-id IGW_ID --region ap-south-1
aws ec2 associate-route-table --route-table-id RTB_ID --subnet-id PUBLIC_SUBNET_1_ID --region ap-south-1
aws ec2 associate-route-table --route-table-id RTB_ID --subnet-id PUBLIC_SUBNET_2_ID --region ap-south-1

# Enable public IP on public subnets
aws ec2 modify-subnet-attribute --subnet-id PUBLIC_SUBNET_1_ID --map-public-ip-on-launch --region ap-south-1
aws ec2 modify-subnet-attribute --subnet-id PUBLIC_SUBNET_2_ID --map-public-ip-on-launch --region ap-south-1
```

### Step 6 — Create NAT Gateway (Required for Private Subnet ECR Access)

```bash
# Allocate Elastic IP
aws ec2 allocate-address --domain vpc --region ap-south-1

# Create NAT Gateway in PUBLIC subnet
aws ec2 create-nat-gateway --subnet-id PUBLIC_SUBNET_1_ID --allocation-id ALLOC_ID --region ap-south-1

# Wait for NAT Gateway to become available (~2-3 minutes), then:
aws ec2 create-route-table --vpc-id VPC_ID --region ap-south-1
aws ec2 create-route --route-table-id PRIVATE_RTB_ID --destination-cidr-block 0.0.0.0/0 --nat-gateway-id NAT_GW_ID --region ap-south-1
aws ec2 associate-route-table --route-table-id PRIVATE_RTB_ID --subnet-id PRIVATE_SUBNET_ID --region ap-south-1
```

### Step 7 — Create ECR Repository

```bash
aws ecr create-repository --repository-name devops-case1 --region ap-south-1
```

### Step 8 — Build and Push Docker Image to ECR

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

# Build and push
docker build -t devops-case1 ./app
docker tag devops-case1:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/devops-case1:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/devops-case1:latest
```

### Step 9 — Create ECS Task Execution Role

```bash
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### Step 10 — Register ECS Task Definition

Update `task-definition.json` with your account ID and ECR URI, then:

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json --region ap-south-1
```

### Step 11 — Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name my-cluster --region ap-south-1
```

### Step 12 — Create Security Groups

```bash
# ALB security group
aws ec2 create-security-group --group-name devops-alb-sg --description "ALB Security Group" --vpc-id VPC_ID --region ap-south-1
aws ec2 authorize-security-group-ingress --group-id ALB_SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region ap-south-1
aws ec2 authorize-security-group-ingress --group-id ALB_SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --region ap-south-1

# ECS security group — only allow traffic from ALB
aws ec2 create-security-group --group-name devops-ecs-sg --description "ECS Security Group" --vpc-id VPC_ID --region ap-south-1
aws ec2 authorize-security-group-ingress --group-id ECS_SG_ID --protocol tcp --port 3000 --source-group ALB_SG_ID --region ap-south-1
```

### Step 13 — Create Load Balancer (via AWS Console)

1. Go to **EC2 → Load Balancers → Create → Application Load Balancer**
2. Name: `devops-alb`, Scheme: Internet-facing
3. Select both public subnets
4. Security group: `devops-alb-sg`
5. Create Target Group: name `devops-tg`, type IP, port 3000, health check `/health`
6. Listener: HTTP 80 → redirect to HTTPS 443; HTTPS 443 → forward to `devops-tg`

### Step 14 — Create ECS Service

```bash
aws ecs create-service \
  --cluster my-cluster \
  --service-name my-service \
  --task-definition devops-case1 \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[PRIVATE_SUBNET_ID],securityGroups=[ECS_SG_ID],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=TARGET_GROUP_ARN,containerName=app,containerPort=3000" \
  --region ap-south-1
```

### Step 15 — Set Up CloudFront

1. Go to **CloudFront → Create Distribution**
2. Origin: ALB DNS name
3. Cache behavior: cache `/health`; no-cache for `/login` and `/items`
4. Viewer protocol: redirect HTTP to HTTPS

---

## Testing the Application

```bash
# Set your ALB DNS
ALB="http://devops-alb-XXXXX.ap-south-1.elb.amazonaws.com"

# 1. Health check
curl $ALB/health

# 2. Login and capture token
TOKEN=$(curl -s -X POST $ALB/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 3. Access protected endpoint without token (should return 401)
curl $ALB/items

# 4. Access protected endpoint with token (should return items)
curl $ALB/items -H "Authorization: Bearer $TOKEN"
```

---

## Security Controls Implemented

| Control | Implementation |
|---|---|
| Private Subnet Isolation | ECS tasks have no public IP, only reachable via ALB |
| JWT Authentication | 1-hour expiry tokens, signed with secret key |
| Security Headers | Helmet.js on all responses |
| Non-root Container | Custom appuser in Dockerfile |
| Minimal Base Image | node:20-alpine |
| Security Groups | ECS only accepts port 3000 from ALB SG |

---

## Cleanup Instructions

```bash
# 1. Delete ECS service
aws ecs update-service --cluster my-cluster --service my-service --desired-count 0 --region ap-south-1
aws ecs delete-service --cluster my-cluster --service my-service --region ap-south-1

# 2. Delete ECS cluster
aws ecs delete-cluster --cluster my-cluster --region ap-south-1

# 3. Delete NAT Gateway (saves ~$32/month)
aws ec2 delete-nat-gateway --nat-gateway-id NAT_GW_ID --region ap-south-1

# 4. Release Elastic IP
aws ec2 release-address --allocation-id ALLOC_ID --region ap-south-1

# 5. Delete ECR repository
aws ecr delete-repository --repository-name devops-case1 --force --region ap-south-1

# 6. Delete Load Balancer and Target Group (via Console)
# EC2 → Load Balancers → Delete
# EC2 → Target Groups → Delete

# 7. Delete CloudFront distribution (via Console)
# Disable first, wait, then delete

# 8. Delete VPC and all networking (via Console)
# VPC → Your VPCs → Delete VPC (deletes subnets, route tables, IGW automatically)
```
