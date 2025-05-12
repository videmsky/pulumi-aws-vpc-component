import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface VpcArgs {
  description: string;
  baseTags: aws.Tags;
  baseCidr: string;
  availabilityZoneNames: string[];
}

export class Vpc extends pulumi.ComponentResource {
  vpc: aws.ec2.Vpc;
  internetGateway: aws.ec2.InternetGateway;
  publicSubnets: aws.ec2.Subnet[] = [];
  privateSubnets: aws.ec2.Subnet[] = [];
  publicRouteTable: aws.ec2.RouteTable;
  privateRouteTables: aws.ec2.RouteTable[] = [];
  natGateways: aws.ec2.NatGateway[] = [];
  natElasticIpAddresses: aws.ec2.Eip[] = [];

  private name: string;
  private baseTags: aws.Tags;

  /**
   * Returns the IDs of the private subnets in this VPC.
   */
  public privateSubnetIds(): pulumi.Output<string>[] {
    return this.privateSubnets.map(x => x.id);
  }

  /**
   * Returns the IDs of the public subnets in this VPC.
   */
  public publicSubnetIds(): pulumi.Output<string>[] {
    return this.publicSubnets.map(x => x.id);
  }

  /**
   * Returns the ID of this VPC.
   */
  public vpcId(): pulumi.Output<string> {
    return this.vpc.id;
  }

  constructor(name: string, args: VpcArgs, opts?: pulumi.ResourceOptions) {
    super("vpc", name, {}, opts);

    this.name = name;
    this.baseTags = args.baseTags;

    // VPC
    this.vpc = new aws.ec2.Vpc(`${name}-vpc`, {
      cidrBlock: args.baseCidr,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: {
        ...args.baseTags,
        Name: `${args.description}`,
      },
    }, { parent: this });

    // Internet Gateway
    this.internetGateway = new aws.ec2.InternetGateway(`${name}-igw`, {
      vpcId: this.vpc.id,
      tags: {
        ...args.baseTags,
        Name: `${args.description} VPC Internet Gateway`,
      },
    }, { parent: this.vpc });

    // Calculate subnet address spaces and create subnets
    {
      const distributor = new SubnetDistributor(args.baseCidr, args.availabilityZoneNames.length);
      this.publicSubnets = distributor.publicSubnets().map((cidr, index) => {
        return new aws.ec2.Subnet(`${name}-public-${index + 1}`, {
          vpcId: this.vpc.id,
          cidrBlock: cidr,
          mapPublicIpOnLaunch: true,
          availabilityZone: args.availabilityZoneNames[index],
          tags: {
            ...args.baseTags,
            Name: `${args.description} Public ${index + 1}`,
          },
        }, { parent: this.vpc });
      });
      this.privateSubnets = distributor.privateSubnets().map((cidr, index) => {
        return new aws.ec2.Subnet(`${name}-private-${index + 1}`, {
          vpcId: this.vpc.id,
          cidrBlock: cidr,
          availabilityZone: args.availabilityZoneNames[index],
          tags: {
            ...args.baseTags,
            Name: `${args.description} Private ${index + 1}`,
          },
        }, { parent: this.vpc });
      });
    }

    // Adopt the default route table for the VPC, and adapt it for use with public subnets
    {
      this.publicRouteTable = <aws.ec2.RouteTable>new aws.ec2.DefaultRouteTable(`${name}-public-rt`, {
        defaultRouteTableId: this.vpc.defaultRouteTableId,
        tags: {
          ...args.baseTags,
          Name: `${args.description} Public Route Table`,
        },
      }, { parent: this.vpc });

      new aws.ec2.Route(`${name}-route-public-sn-to-ig`, {
        routeTableId: this.publicRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: this.internetGateway.id,
      }, { parent: this.publicRouteTable });

      this.publicSubnets.map((subnet, index) => {
        return new aws.ec2.RouteTableAssociation(`${name}-public-rta-${index + 1}`, {
          subnetId: subnet.id,
          routeTableId: this.publicRouteTable.id,
        }, { parent: this.publicRouteTable });
      });
    }

    // Create a NAT Gateway and appropriate route table for each private subnet
    for (let index = 0; index < this.privateSubnets.length; index++) {
      const privateSubnet = this.privateSubnets[index];
      const publicSubnet = this.publicSubnets[index];

      this.natElasticIpAddresses.push(new aws.ec2.Eip(`${name}-nat-${index + 1}`, {
        vpc: true,
        tags: {
          ...args.baseTags,
          Name: `${args.description} NAT Gateway EIP ${index + 1}`,
        },
      }, { parent: privateSubnet }));

      this.natGateways.push(new aws.ec2.NatGateway(`${name}-nat-gateway-${index + 1}`, {
        allocationId: this.natElasticIpAddresses[index].id,
        subnetId: publicSubnet.id,
        tags: {
          ...args.baseTags,
          Name: `${args.description} NAT Gateway ${index + 1}`,
        },
      }, { parent: privateSubnet }));

      this.privateRouteTables.push(new aws.ec2.RouteTable(`${name}-private-rt-${index + 1}`, {
        vpcId: this.vpc.id,
        tags: {
          ...args.baseTags,
          Name: `${args.description} Private Subnet RT ${index + 1}`,
        },
      }, { parent: privateSubnet }));

      new aws.ec2.Route(`${name}-route-private-sn-to-nat-${index + 1}`, {
        routeTableId: this.privateRouteTables[index].id,
        destinationCidrBlock: "0.0.0.0/0",
        natGatewayId: this.natGateways[index].id,
      }, { parent: this.privateRouteTables[index] });

      new aws.ec2.RouteTableAssociation(`${name}-private-rta-${index + 1}`, {
        subnetId: privateSubnet.id,
        routeTableId: this.privateRouteTables[index].id,
      }, { parent: this.privateRouteTables[index] });
    }

    this.registerOutputs({});
  }
}

/**
 * A SubnetDistributor is used to split a given CIDR block into a number of
 * subnets and calculate the address spaces to use for each. Since AWS now allows
 * for additional address spaces to be attached to an existing VPC, we do not
 * reserve any additional space.
 */
class SubnetDistributor {
  private readonly _privateSubnets: string[];
  private readonly _publicSubnets: string[];

  /**
   * Creates a subnet distributor configured to split the baseCidr into a fixed
   * number of public/private subnet pairs.
   * @param {string} baseCidr The CIDR block to split.
   * @param {number} azCount The number of subnet pairs to produce.
   */
  constructor(baseCidr: string, azCount: number) {
    const newBitsPerAZ = Math.log2(SubnetDistributor.nextPow2(azCount));

    const azBases: string[] = [];
    for (let i = 0; i < azCount; i++) {
      azBases.push(SubnetDistributor.subnetV4(baseCidr, newBitsPerAZ, i));
    }

    this._privateSubnets = azBases.map((block) => {
      return SubnetDistributor.subnetV4(block, 1, 0);
    });

    this._publicSubnets = this._privateSubnets.map((block) => {
      const splitBase = SubnetDistributor.subnetV4(block, 0, 1);
      return SubnetDistributor.subnetV4(splitBase, 2, 0);
    });
  }

  /**
   * Returns an array of the CIDR blocks for the private subnets.
   * @returns {string[]}
   */
  public privateSubnets(): string[] {
    return this._privateSubnets;
  }

  /**
   * Returns an array of the CIDR blocks for the public subnets.
   * @returns {string[]}
   */
  public publicSubnets(): string[] {
    return this._publicSubnets;
  }

  /**
   * Constructs a CIDR address based on a block, number of new bits, and network number
   * @param ipRange
   * @param newBits
   * @param netNum
   */
  /** @internal */
  private static subnetV4(ipRange: string, newBits: number, netNum: number): string {
    const ipAddress = require("ip-address");
    const BigInteger = require("jsbn").BigInteger;

    const ipv4 = new ipAddress.Address4(ipRange);
    if (!ipv4.isValid()) {
      throw new Error(`Invalid IP address range: ${ipRange}`);
    }

    const newSubnetMask = ipv4.subnetMask + newBits;
    if (newSubnetMask > 32) {
      throw new Error(`Requested ${newBits} new bits, but ` +
        `only ${32 - ipv4.subnetMask} are available.`);
    }

    const addressBI = ipv4.bigInteger();
    const newAddressBase = Math.pow(2, 32 - newSubnetMask);
    const netNumBI = new BigInteger(netNum.toString());

    const newAddressBI = addressBI.add(new BigInteger(newAddressBase.toString()).multiply(netNumBI));
    const newAddress = ipAddress.Address4.fromBigInteger(newAddressBI).address;

    return `${newAddress}/${newSubnetMask}`;
  }

  /**
   * nextPow2 returns the next integer greater or equal to n which is a power of 2.
   * @param {number} n input number
   * @returns {number} next power of 2 to n (>= n)
   */
  /** @internal */
  private static nextPow2(n: number): number {
    if (n === 0) {
      return 1;
    }

    n--;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;

    return n + 1;
  }
}