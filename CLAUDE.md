# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Commands

```bash
# Install dependencies
npm install

# Build the component
npm run build       # Equivalent to: tsc

# Type checking
tsc --noEmit        # Check for TypeScript errors without emitting files
```

### Policy Pack Commands

```bash
# Navigate to policy pack directory
cd policypack

# Install policy pack dependencies
npm install

# Build the policy pack
npm run build       # Equivalent to: tsc

# Type checking for policy pack
tsc --noEmit        # Check for TypeScript errors without emitting files
```

## Architecture Overview

This repository contains a Pulumi component for creating an AWS VPC with the following features:

1. **Component Structure**: Implemented as a Pulumi ComponentResource in TypeScript
   - Main class: `Vpc` in `index.ts`
   - Helper class: `SubnetDistributor` for CIDR block calculations

2. **Resources Created**:
   - VPC with configurable CIDR block
   - Internet Gateway attached to the VPC
   - Public and private subnets across multiple Availability Zones
   - NAT Gateways in public subnets (one per AZ)
   - Route tables for public and private subnets
   - Routes for internet access (via IGW or NAT Gateway)

3. **Key Features**:
   - Creates a complete, production-ready VPC infrastructure
   - Supports multiple Availability Zones
   - Handles subnet CIDR calculations automatically
   - Applies consistent tagging to all resources

4. **Usage Pattern**:
   - Users provide configuration (CIDR, AZs, tags)
   - Component creates and connects all necessary resources
   - Outputs subnet IDs and VPC ID for referencing in other resources

5. **Policy Pack**:
   - Simple policy pack included for demonstrating AWS resource validation
   - Currently checks S3 bucket ACLs to prevent public access

## Important Notes

1. The component follows Pulumi best practices for resource organization:
   - Parent-child relationships used for proper resource tracking
   - Consistent naming patterns across resources
   - Output methods for accessing resource IDs

2. The `SubnetDistributor` class handles the complex logic of:
   - Dividing the VPC CIDR block into subnet ranges
   - Ensuring proper sizing for the number of Availability Zones
   - Separating public and private subnet address spaces

3. The component requires third-party npm packages:
   - "ip-address" for IP handling
   - "jsbn" for large integer operations

4. All resource creation is handled in the constructor of the `Vpc` class, providing a clean API for users.

## Pulumi Policies and AWS Config
This repo contains a single Pulumi policy pack written in TypeScript.

The AWS Config service is built into AWS and is not open source, but the documentation has precise definitions of the rules, identifiers, CloudFormation resource types, parameters, and so on. AWS Config ruleset is described here:
https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html.

Although Pulumi's AWS Classic provider, which this policy pack targets, has slightly different types than CloudFormation, the coverage is such that we can still encode each rule into a Pulumi policy pack rule.

The pack's code follows idiomatic TypeScript coding conventions and chooses to be as precise as possible -- such as preferring to target specific known resources using validateResource combined with validateResourceofType, rather than validateStack, when possible. Of course, some rules must look at multiple resources and thus use stack policies.

The rules do as much as possible using the infrastructure definitions, but some rules may require access to the AWS API. You can assume you're running in a context with read-only AWS API access, so you can use the AWS SDK if needed.

Each rule is configurable and the pack itself may be configured to enable or disable specific rules and groups of rules.

### List of rules

Here is a snapshot of the list of rule names related to VPCs as of May 14, 2025:

vpc-default-security-group-closed
vpc-endpoint-enabled
vpc-flow-logs-enabled
vpc-network-acl-unused-check
vpc-peering-dns-resolution-check
vpc-sg-open-only-to-authorized-ports
vpc-sg-port-restriction-check

## Style
In addition to writing idiomatic TypeScript, follow these rules:
* Always end the file with a newline. Remove excessive and unnecessary whitespace.