### AWS VPC Pulumi Component

This Pulumi component provides a reusable way to create a complete AWS VPC infrastructure with public and private subnets, NAT Gateways, and all necessary routing configurations.

#### Installation
`pulumi package add https://github.com/videmsky/pulumi-aws-vpc-component@v1.0.0`

Add the following to your Pulumi.yaml for project that consumes this component:

```bash
packages:
  aws-vpc: https://github.com/videmsky/pulumi-aws-vpc-component@v1.0.1
```

> **Note:**
> - If you are using a **YAML Pulumi program**, you must include the `packages` section in your `Pulumi.yaml` as shown above. This is how Pulumi knows to fetch the component from GitHub.
> - The `pulumi package add ...` CLI command is intended for code-based Pulumi projects (TypeScript, Python, Go, C#). For YAML programs, you only need to update your `Pulumi.yaml`.

#### Use SDK in Program

##### Typescript
```typescript
import * as pulumi from "@pulumi/pulumi";
import { Vpc } from "@videmsky/aws-vpc";

const config = new pulumi.Config();
const name = config.require("name");
const azCount = config.getNumber("azCount") || 2;
const baseCidr = config.get("baseCidr") || "10.0.0.0/16";

const baseTags = {
	owner: name,
	stack: pulumi.getStack(),
};

const availabilityZones = aws.getAvailabilityZones({
	state: "available",
});

// Create a new VPC
const outputs = availabilityZones.then(zones => {
	const vpc = new Vpc(`${name}-vpc`, {
		description: `${baseTags.owner} VPC`,
		baseTags: baseTags,
		baseCidr: baseCidr,
		availabilityZoneNames: zones.names.slice(0, azCount),
	});

	return {
		vpcId: vpc.vpcId(),
		vpcPrivateSubnetIds: vpc.privateSubnetIds(),
		vpcPublicSubnetIds: vpc.publicSubnetIds(),
	}
});

// Export the VPC ID
export const vpcId = outputs.then(x => x.vpcId);

// Export subnet IDs
export const vpcPrivateSubnetIds = outputs.then(x => x.vpcPrivateSubnetIds);
export const vpcPublicSubnetIds = outputs.then(x => x.vpcPublicSubnetIds);
```

##### Python
```python
import pulumi
import pulumi_aws as aws
from videmsky.aws_vpc import Vpc

config = pulumi.Config()
name = config.require("name")
az_count = config.get_int("azCount") or 2
base_cidr = config.get("baseCidr") or "10.0.0.0/16"

base_tags = {
	"owner": name,
	"stack": pulumi.get_stack(),
}

# Get available AZs
availability_zones = aws.get_availability_zones(state="available")

# Create a new VPC
def create_vpc(zones):
	vpc = Vpc(f"{name}-vpc",
		description=f"{base_tags['owner']} VPC",
		base_tags=base_tags,
		base_cidr=base_cidr,
		availability_zone_names=zones.names[:az_count]
	)
	
	return {
		"vpc_id": vpc.vpc_id(),
		"vpc_private_subnet_ids": vpc.private_subnet_ids(),
		"vpc_public_subnet_ids": vpc.public_subnet_ids(),
	}

outputs = availability_zones.apply(create_vpc)

# Export the VPC ID
pulumi.export("vpc_id", outputs.apply(lambda x: x["vpc_id"]))

# Export subnet IDs
pulumi.export("vpc_private_subnet_ids", outputs.apply(lambda x: x["vpc_private_subnet_ids"]))
pulumi.export("vpc_public_subnet_ids", outputs.apply(lambda x: x["vpc_public_subnet_ids"]))
```

##### Go
```go
package main

import (
	"github.com/pulumi/pulumi-aws/sdk/v6/go/aws"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/videmsky/aws-vpc/sdk/go/aws-vpc"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		name := ctx.Config().Require("name")
		azCount := ctx.Config().GetInt("azCount")
		if azCount == nil {
			defaultAzCount := 2
			azCount = &defaultAzCount
		}
		baseCidr := ctx.Config().Get("baseCidr")
		if baseCidr == nil {
			defaultCidr := "10.0.0.0/16"
			baseCidr = &defaultCidr
		}

		baseTags := pulumi.StringMap{
			"owner": pulumi.String(name),
			"stack": pulumi.String(ctx.Stack()),
		}

		azs, err := aws.GetAvailabilityZones(ctx, &aws.GetAvailabilityZonesArgs{
			State: pulumi.StringRef("available"),
		})
		if err != nil {
			return err
		}

		vpc, err := awsvpc.NewVpc(ctx, name+"-vpc", &awsvpc.VpcArgs{
			Description:           pulumi.String(name + " VPC"),
			BaseTags:              baseTags,
			BaseCidr:              pulumi.String(*baseCidr),
			AvailabilityZoneNames: toPulumiStringArray(azs.Names[:*azCount]),
		})
		if err != nil {
			return err
		}

		ctx.Export("vpcId", vpc.VpcId())
		ctx.Export("vpcPrivateSubnetIds", vpc.PrivateSubnetIds())
		ctx.Export("vpcPublicSubnetIds", vpc.PublicSubnetIds())
		return nil
	})
}

// Helper to convert []string to pulumi.StringArray
func toPulumiStringArray(arr []string) pulumi.StringArray {
	result := make(pulumi.StringArray, len(arr))
	for i, v := range arr {
		result[i] = pulumi.String(v)
	}
	return result
}
```

##### C#
```csharp
using Pulumi;
using Pulumi.Aws;
using Videmsky.AwsVpc;

class MyStack : Stack
{
	public MyStack()
	{
		var config = new Config();
		var name = config.Require("name");
		var azCount = config.GetInt32("azCount") ?? 2;
		var baseCidr = config.Get("baseCidr") ?? "10.0.0.0/16";

		var baseTags = new InputMap<string>
		{
			{ "owner", name },
			{ "stack", Deployment.Instance.StackName }
		};

		var azs = Output.Create(GetAvailabilityZones.InvokeAsync(new GetAvailabilityZonesArgs
		{
			State = "available"
		}));

		var outputs = azs.Apply(zones =>
		{
			var vpc = new Vpc($"{name}-vpc", new VpcArgs
			{
				Description = $"{name} VPC",
				BaseTags = baseTags,
				BaseCidr = baseCidr,
				AvailabilityZoneNames = zones.Names.Take(azCount).ToArray()
			});

			return new
			{
				vpcId = vpc.VpcId(),
				vpcPrivateSubnetIds = vpc.PrivateSubnetIds(),
				vpcPublicSubnetIds = vpc.PublicSubnetIds()
			};
		});

		this.VpcId = outputs.Apply(o => o.vpcId);
		this.VpcPrivateSubnetIds = outputs.Apply(o => o.vpcPrivateSubnetIds);
		this.VpcPublicSubnetIds = outputs.Apply(o => o.vpcPublicSubnetIds);

		Output<string> VpcId { get; }
		Output<ImmutableArray<string>> VpcPrivateSubnetIds { get; }
		Output<ImmutableArray<string>> VpcPublicSubnetIds { get; }
	}
}
```

##### YAML
```yaml
config:
  name: my-vpc
  azCount: 2
  baseCidr: 10.0.0.0/16

resources:
  availabilityZones:
    type: aws:index/getAvailabilityZones:getAvailabilityZones
    properties:
      state: available

  vpc:
    type: videmsky:aws-vpc:Vpc
    properties:
      description: ${name} VPC
      baseTags:
        owner: ${name}
        stack: ${pulumi.stack}
      baseCidr: ${baseCidr}
      availabilityZoneNames: ${availabilityZones.names[0:${azCount}]}

outputs:
  vpcId: ${vpc.vpcId}
  vpcPrivateSubnetIds: ${vpc.privateSubnetIds}
  vpcPublicSubnetIds: ${vpc.publicSubnetIds}
```

#### Configuration

The `Vpc` component accepts the following configuration:

| Parameter | Type | Description |
|-----------|------|-------------|
| description | string | Description of the VPC (used in resource names) |
| baseTags | aws.Tags | Base tags to apply to all resources |
| baseCidr | string | The CIDR block for the VPC (e.g., "10.0.0.0/16") |
| availabilityZoneNames | string[] | List of availability zones to create subnets in |

#### Outputs

The component provides the following helper methods:

- `vpcId()`: Returns the ID of the created VPC
- `privateSubnetIds()`: Returns an array of private subnet IDs
- `publicSubnetIds()`: Returns an array of public subnet IDs

#### Architecture

The component creates the following resources:

1. VPC with the specified CIDR block
2. Internet Gateway attached to the VPC
3. Public subnets (one per AZ) with:
   - Route table with route to Internet Gateway
   - Auto-assign public IP addresses
4. Private subnets (one per AZ) with:
   - NAT Gateway in the corresponding public subnet
   - Route table with route to NAT Gateway
   - Elastic IP for each NAT Gateway
