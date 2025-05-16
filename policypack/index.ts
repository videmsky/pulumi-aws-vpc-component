/**
 * AWS VPC Policy Pack
 * 
 * This policy pack implements AWS Config rules for VPC resources as Pulumi policies.
 * Each policy is configurable and follows AWS Config rule specifications.
 * 
 * Implemented policies:
 * - vpc-default-security-group-closed: Checks if default security groups of VPCs allow inbound or outbound traffic.
 * - vpc-endpoint-enabled: Checks if required VPC endpoints are enabled for your VPCs.
 * - vpc-flow-logs-enabled: Checks if Amazon VPC Flow Logs are enabled for your VPCs.
 * - vpc-network-acl-unused-check: Checks if there are unused network ACLs in your Amazon VPC.
 * - vpc-peering-dns-resolution-check: Checks if DNS resolution from accepter/requester VPC to private IP is enabled.
 * - vpc-sg-open-only-to-authorized-ports: Checks security groups for unrestricted access on non-authorized ports.
 * - vpc-sg-port-restriction-check: Checks security groups for unrestricted access on sensitive ports.
 */

import * as aws from "@pulumi/aws";
import { PolicyPack, PolicyConfigSchema, validateResourceOfType, validateStackResourcesOfType } from "@pulumi/policy";

/**
 * Configuration for vpc-endpoint-enabled policy
 */
interface VpcEndpointEnabledConfig {
	services?: string[];
	vpcIds?: string[];
}

/**
 * Configuration for vpc-flow-logs-enabled policy
 */
interface VpcFlowLogsEnabledConfig {
	trafficType?: string;
	vpcIds?: string[];
}

/**
 * Configuration for vpc-sg-open-only-to-authorized-ports policy
 */
interface VpcSgOpenOnlyToAuthorizedPortsConfig {
	authorizedTcpPorts?: string;
	authorizedUdpPorts?: string;
}

/**
 * Configuration for vpc-sg-port-restriction-check policy
 */
interface VpcSgPortRestrictionCheckConfig {
	restrictPorts?: string;
	protocolType?: string;
	ipType?: string;
	excludeExternalSecurityGroups?: boolean;
}

/**
 * Configuration for vpc-peering-dns-resolution-check policy
 */
interface VpcPeeringDnsResolutionCheckConfig {
	vpcIds?: string[];
}

/**
 * Configuration schemas for policy rules
 */
const configSchemas = {
	vpcEndpointEnabled: {
		properties: {
			services: {
				type: "array" as const,
				items: { type: "string" as const },
				description: "List of service names required for VPC endpoints",
				default: ["eks"],
			},
			vpcIds: {
				type: "array" as const,
				items: { type: "string" as const },
				description: "Optional list of specific VPC IDs to check. If not provided, all VPCs are checked.",
				default: [],
			},
		}
	},
	vpcFlowLogsEnabled: {
		properties: {
			trafficType: {
				type: "string" as const,
				description: "The type of traffic to log (ACCEPT, REJECT, or ALL)",
				default: "ALL",
				enum: ["ACCEPT", "REJECT", "ALL"]
			},
			vpcIds: {
				type: "array" as const,
				items: { type: "string" as const },
				description: "Optional list of specific VPC IDs to check. If not provided, all VPCs are checked.",
				default: [],
			},
		}
	},
	vpcSgOpenOnlyToAuthorizedPorts: {
		properties: {
			authorizedTcpPorts: {
				type: "string" as const,
				description: "Comma-separated list of authorized TCP ports or port ranges (e.g., '443,1020-1025')",
				default: "443,80",
			},
			authorizedUdpPorts: {
				type: "string" as const,
				description: "Comma-separated list of authorized UDP ports or port ranges (e.g., '500,1020-1025')",
				default: "",
			},
		}
	},
	vpcSgPortRestrictionCheck: {
		properties: {
			restrictPorts: {
				type: "string" as const,
				description: "Comma-separated list of restricted ports that should not be open to the internet",
				default: "22,3389",
			},
			protocolType: {
				type: "string" as const,
				description: "Protocol type to check (TCP, UDP, or ALL)",
				default: "ALL",
				enum: ["TCP", "UDP", "ALL"],
			},
			ipType: {
				type: "string" as const,
				description: "IP version to check (IPv4, IPv6, or ALL)",
				default: "ALL",
				enum: ["IPv4", "IPv6", "ALL"],
			},
			excludeExternalSecurityGroups: {
				type: "boolean" as const,
				description: "Whether to exclude external security groups from evaluation",
				default: true,
			},
		}
	},
	vpcPeeringDnsResolutionCheck: {
		properties: {
			vpcIds: {
				type: "array" as const,
				items: { type: "string" as const },
				description: "Optional list of specific VPC IDs to check. If not provided, all VPC peering connections are checked.",
				default: [],
			},
		}
	},
};

/**
 * Helper function to check if a port is within a range or matches a specific port
 */
function isPortAuthorized(port: number, authorizedPortsStr: string): boolean {
	if (!authorizedPortsStr) {
		return false;
	}
	
	const authorizedPorts = authorizedPortsStr.split(',').map(p => p.trim());
	
	for (const authorizedPort of authorizedPorts) {
		// Check if it's a port range (e.g., "1020-1025")
		if (authorizedPort.includes('-')) {
			const [rangeStart, rangeEnd] = authorizedPort.split('-').map(Number);
			if (port >= rangeStart && port <= rangeEnd) {
				return true;
			}
		} 
		// Check if it's a specific port
		else if (parseInt(authorizedPort) === port) {
			return true;
		}
	}
	
	return false;
}

/**
 * Check if CIDR block represents global access (0.0.0.0/0 or ::/0)
 */
function isGloballyAccessible(cidrBlock: string): boolean {
	return cidrBlock === "0.0.0.0/0" || cidrBlock === "::/0";
}

/**
 * Filter global IP access based on IP type configuration
 */
function shouldCheckIpType(cidrBlock: string, ipType: string): boolean {
	if (ipType === "ALL") {
		return true;
	} else if (ipType === "IPv4" && cidrBlock === "0.0.0.0/0") {
		return true;
	} else if (ipType === "IPv6" && cidrBlock === "::/0") {
		return true;
	}
	return false;
}

/**
 * AWS VPC Policy Pack
 */
new PolicyPack("aws-vpc-rules", {
	policies: [
		{
			name: "vpc-default-security-group-closed",
			description: "Checks if default security groups of VPCs allow inbound or outbound traffic.",
			enforcementLevel: "advisory",
			validateResource: validateResourceOfType(aws.ec2.SecurityGroup, (sg, args, reportViolation) => {
				// Check if this is a default security group
				if (sg.name === "default" || sg.namePrefix === "default") {
					// Check for any ingress rules
					if (sg.ingress && sg.ingress.length > 0) {
						reportViolation(
							"Default security group should not have any inbound traffic rules. " +
							"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-default-security-group-closed.html"
						);
					}
					
					// Check for any egress rules
					if (sg.egress && sg.egress.length > 0) {
						reportViolation(
							"Default security group should not have any outbound traffic rules. " +
							"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-default-security-group-closed.html"
						);
					}
				}
			}),
		},
		{
			name: "vpc-endpoint-enabled",
			description: "Checks if required VPC endpoints are enabled for your VPCs.",
			enforcementLevel: "advisory",
			configSchema: configSchemas.vpcEndpointEnabled as PolicyConfigSchema,
			validateStack: (args, reportViolation) => {
				// Get configuration or use defaults
				const config = args.getConfig<VpcEndpointEnabledConfig>() || {};
				const requiredServices = config.services || ["eks"];
				const specificVpcIds = config.vpcIds || [];
				
				// Find all VPCs in the stack
				const vpcs = args.resources.filter(r => r.type === "aws:ec2/vpc:Vpc");
				
				// If no VPCs in the stack, there's nothing to evaluate
				if (vpcs.length === 0) {
					return;
				}
				
				// Find all VPC endpoints in the stack
				const vpcEndpoints = args.resources.filter(r => r.type === "aws:ec2/vpcEndpoint:VpcEndpoint");
				
				// Filter VPCs if specific IDs were provided in the config
				const vpcsToCheck = specificVpcIds.length > 0
					? vpcs.filter(vpc => specificVpcIds.includes(vpc.props.id))
					: vpcs;
				
				// Check each VPC for the required endpoints
				for (const vpc of vpcsToCheck) {
					const vpcId = vpc.props.id;
					const vpcName = vpc.props.name || vpc.props.id;
					
					// Check for each required service
					for (const service of requiredServices) {
						// See if we have an endpoint for this VPC and service
						const hasEndpoint = vpcEndpoints.some(endpoint => {
							const props = endpoint.props || {};
							return props.vpcId === vpcId && 
								props.serviceName && 
								typeof props.serviceName === 'string' && 
								props.serviceName.includes(service);
						});
						
						// If no endpoint exists for this service, report a violation
						if (!hasEndpoint) {
							reportViolation(
								`VPC '${vpcName}' does not have a required VPC endpoint for the '${service}' service. ` +
								"VPC endpoints improve security by keeping traffic within the AWS network. " +
								"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-endpoint-enabled.html"
							);
						}
					}
				}
			}
		},
		{
			name: "vpc-flow-logs-enabled",
			description: "Checks if Amazon VPC Flow Logs are enabled for your VPCs to monitor network traffic.",
			enforcementLevel: "advisory",
			configSchema: configSchemas.vpcFlowLogsEnabled as PolicyConfigSchema,
			validateStack: (args, reportViolation) => {
				// Get configuration or use defaults
				const config = args.getConfig<VpcFlowLogsEnabledConfig>() || {};
				const trafficType = config.trafficType || "ALL";
				const specificVpcIds = config.vpcIds || [];
				
				// Find all VPCs in the stack
				const vpcs = args.resources.filter(r => r.type === "aws:ec2/vpc:Vpc");
				
				// If no VPCs in the stack, there's nothing to evaluate
				if (vpcs.length === 0) {
					return;
				}
				
				// Find all Flow Logs in the stack
				const flowLogs = args.resources.filter(r => r.type === "aws:ec2/flowLog:FlowLog");
				
				// Filter VPCs if specific IDs were provided in the config
				const vpcsToCheck = specificVpcIds.length > 0
					? vpcs.filter(vpc => specificVpcIds.includes(vpc.props.id))
					: vpcs;
				
				// Check each VPC for flow logs
				for (const vpc of vpcsToCheck) {
					const vpcId = vpc.props.id;
					const vpcName = vpc.props.name || vpc.props.id;
					
					// Check if flow log exists for this VPC
					const hasFlowLog = flowLogs.some(log => {
						const props = log.props || {};
						
						// First check if this flow log is for our VPC
						const isForVpc = props.vpcId === vpcId || 
							(props.resourceId === vpcId && props.resourceType === "VPC");
						
						// If traffic type is specified, check it matches
						const matchesTrafficType = !trafficType || 
							!props.trafficType || 
							props.trafficType === trafficType;
						
						return isForVpc && matchesTrafficType;
					});
					
					// If no flow log exists for this VPC, report a violation
					if (!hasFlowLog) {
						const trafficTypeMessage = trafficType 
							? ` with traffic type '${trafficType}'` 
							: "";
						
						reportViolation(
							`VPC '${vpcName}' does not have flow logs enabled${trafficTypeMessage}. ` +
							"Flow logs are essential for monitoring, security analysis, and troubleshooting connectivity issues. " +
							"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-flow-logs-enabled.html"
						);
					}
				}
			}
		},
		{
			name: "vpc-network-acl-unused-check",
			description: "Checks if there are unused network ACLs in your Amazon VPC.",
			enforcementLevel: "advisory",
			validateStack: (args, reportViolation) => {
				// Find all Network ACLs in the stack
				const networkAcls = args.resources.filter(r => r.type === "aws:ec2/networkAcl:NetworkAcl");
				
				// If no Network ACLs in the stack, there's nothing to evaluate
				if (networkAcls.length === 0) {
					return;
				}
				
				// Find all Network ACL Associations in the stack
				const aclAssociations = args.resources.filter(r => r.type === "aws:ec2/networkAclAssociation:NetworkAclAssociation");
				
				// Look for network ACLs that don't have any associations with subnets
				for (const acl of networkAcls) {
					const aclId = acl.props.id;
					const aclName = acl.props.name || acl.props.id;
					
					// Skip Default ACLs - they're typically attached to the default subnet already
					const props = acl.props || {};
					if (props.default === true) {
						continue;
					}
					
					// Check if this ACL is associated with any subnet
					const isUsed = aclAssociations.some(assoc => {
						const assocProps = assoc.props || {};
						return assocProps.networkAclId === aclId;
					});
					
					// Check if there's a subnetId directly in the ACL props (for some implementations)
					const hasDirectAssociation = Array.isArray(props.subnetIds) && props.subnetIds.length > 0;
					
					// If the ACL isn't associated with any subnet, report a violation
					if (!isUsed && !hasDirectAssociation) {
						reportViolation(
							`Network ACL '${aclName}' is not associated with any subnet. ` +
							"Unused network ACLs should be removed to maintain a clean and manageable environment. " +
							"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-network-acl-unused-check.html"
						);
					}
				}
			}
		},
		{
			name: "vpc-peering-dns-resolution-check",
			description: "Checks if DNS resolution from accepter/requester VPC to private IP is enabled for VPC peering connections.",
			enforcementLevel: "advisory",
			configSchema: configSchemas.vpcPeeringDnsResolutionCheck as PolicyConfigSchema,
			validateResource: validateResourceOfType(aws.ec2.VpcPeeringConnection, (peeringConnection, args, reportViolation) => {
				// Get configuration or use defaults
				const config = args.getConfig<VpcPeeringDnsResolutionCheckConfig>() || {};
				const specificVpcIds = config.vpcIds || [];
				
				// Extract the accepter and requester VPC IDs
				const accepterVpcId = peeringConnection.peerVpcId;
				const requesterVpcId = peeringConnection.vpcId;
				
				// Skip if we're filtering by specific VPC IDs and neither VPC in this peering connection is in the list
				if (specificVpcIds.length > 0 && 
					!specificVpcIds.includes(accepterVpcId) && 
					!specificVpcIds.includes(requesterVpcId)) {
					return;
				}
				
				// Check DNS resolution settings - both must be enabled for compliance
				const accepterDnsResolution = peeringConnection.accepter?.allowRemoteVpcDnsResolution === true;
				const requesterDnsResolution = peeringConnection.requester?.allowRemoteVpcDnsResolution === true;
				
				// Report violation if either direction of DNS resolution is not enabled
				if (!accepterDnsResolution) {
					const pcName = peeringConnection.tags?.Name || `(accepter: ${peeringConnection.peerVpcId}, requester: ${peeringConnection.vpcId})`;
					reportViolation(
						`VPC Peering Connection '${pcName}' does not have DNS resolution enabled for accepter VPC. ` +
						"DNS resolution should be enabled for VPC peering connections to allow instances to resolve DNS hostnames to private IP addresses. " +
						"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-peering-dns-resolution-check.html"
					);
				}
				
				if (!requesterDnsResolution) {
					const pcName = peeringConnection.tags?.Name || `(accepter: ${peeringConnection.peerVpcId}, requester: ${peeringConnection.vpcId})`;
					reportViolation(
						`VPC Peering Connection '${pcName}' does not have DNS resolution enabled for requester VPC. ` +
						"DNS resolution should be enabled for VPC peering connections to allow instances to resolve DNS hostnames to private IP addresses. " +
						"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-peering-dns-resolution-check.html"
					);
				}
			}),
		},
		{
			name: "vpc-sg-open-only-to-authorized-ports",
			description: "Checks security groups for unrestricted access (0.0.0.0/0 or ::/0) on non-authorized ports.",
			enforcementLevel: "advisory",
			configSchema: configSchemas.vpcSgOpenOnlyToAuthorizedPorts as PolicyConfigSchema,
			validateResource: validateResourceOfType(aws.ec2.SecurityGroup, (sg, args, reportViolation) => {
				// Skip checking if no ingress rules
				if (!sg.ingress || sg.ingress.length === 0) {
					return;
				}
				
				// Get configuration or use defaults
				const config = args.getConfig<VpcSgOpenOnlyToAuthorizedPortsConfig>() || {};
				const authorizedTcpPorts = config.authorizedTcpPorts || "443,80";
				const authorizedUdpPorts = config.authorizedUdpPorts || "";
				
				// Check each ingress rule for unrestricted access
				for (const rule of sg.ingress) {
					// Skip if no CIDR blocks
					if (!rule.cidrBlocks || rule.cidrBlocks.length === 0) {
						continue;
					}
					
					// Check each CIDR block for global access
					for (const cidrBlock of rule.cidrBlocks) {
						if (isGloballyAccessible(cidrBlock)) {
							// For TCP protocol
							if (rule.protocol === "tcp") {
								// Check if from and to ports are authorized
								const fromPort = rule.fromPort || 0;
								const toPort = rule.toPort || 65535;
								
								// If it's a range of ports
								if (fromPort !== toPort) {
									for (let port = fromPort; port <= toPort; port++) {
										if (!isPortAuthorized(port, authorizedTcpPorts)) {
											reportViolation(
												`Security group '${sg.name}' allows unrestricted TCP access from ${cidrBlock} on unauthorized port ${port}. ` +
												"Only authorized ports should be exposed to the internet. " +
												"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-open-only-to-authorized-ports.html"
											);
											// Break after first violation found for this rule to avoid excessive messages
											break;
										}
									}
								} 
								// If it's a single port
								else if (!isPortAuthorized(fromPort, authorizedTcpPorts)) {
									reportViolation(
										`Security group '${sg.name}' allows unrestricted TCP access from ${cidrBlock} on unauthorized port ${fromPort}. ` +
										"Only authorized ports should be exposed to the internet. " +
										"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-open-only-to-authorized-ports.html"
									);
								}
							}
							// For UDP protocol
							else if (rule.protocol === "udp") {
								// Check if from and to ports are authorized
								const fromPort = rule.fromPort || 0;
								const toPort = rule.toPort || 65535;
								
								// If it's a range of ports
								if (fromPort !== toPort) {
									for (let port = fromPort; port <= toPort; port++) {
										if (!isPortAuthorized(port, authorizedUdpPorts)) {
											reportViolation(
												`Security group '${sg.name}' allows unrestricted UDP access from ${cidrBlock} on unauthorized port ${port}. ` +
												"Only authorized ports should be exposed to the internet. " +
												"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-open-only-to-authorized-ports.html"
											);
											// Break after first violation found for this rule to avoid excessive messages
											break;
										}
									}
								} 
								// If it's a single port
								else if (!isPortAuthorized(fromPort, authorizedUdpPorts)) {
									reportViolation(
										`Security group '${sg.name}' allows unrestricted UDP access from ${cidrBlock} on unauthorized port ${fromPort}. ` +
										"Only authorized ports should be exposed to the internet. " +
										"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-open-only-to-authorized-ports.html"
									);
								}
							}
							// For all other protocols
							else if (rule.protocol === "-1" || rule.protocol === "all") {
								reportViolation(
									`Security group '${sg.name}' allows unrestricted access from ${cidrBlock} for all protocols. ` +
									"This poses a significant security risk. Only specific ports and protocols should be exposed to the internet. " +
									"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-open-only-to-authorized-ports.html"
								);
							}
						}
					}
				}
			}),
		},
		{
			name: "vpc-sg-port-restriction-check",
			description: "Checks security groups for unrestricted access on sensitive ports like SSH (22) and RDP (3389).",
			enforcementLevel: "advisory",
			configSchema: configSchemas.vpcSgPortRestrictionCheck as PolicyConfigSchema,
			validateResource: validateResourceOfType(aws.ec2.SecurityGroup, (sg, args, reportViolation) => {
				// Skip checking if no ingress rules
				if (!sg.ingress || sg.ingress.length === 0) {
					return;
				}
				
				// Get configuration or use defaults
				const config = args.getConfig<VpcSgPortRestrictionCheckConfig>() || {};
				const restrictPortsStr = config.restrictPorts || "22,3389";
				const protocolType = config.protocolType || "ALL";
				const ipType = config.ipType || "ALL";
				const excludeExternalSecurityGroups = config.excludeExternalSecurityGroups === undefined ? true : config.excludeExternalSecurityGroups;
				
				// Parse restricted ports
				const restrictPorts = restrictPortsStr.split(',').map(p => parseInt(p.trim()));
				
				// Skip external security groups if configured
				if (excludeExternalSecurityGroups && sg.name && (sg.name.startsWith("eks-cluster-sg") || sg.name.startsWith("external-"))) {
					return;
				}
				
				// Check each ingress rule
				for (const rule of sg.ingress) {
					// Skip if no CIDR blocks
					if (!rule.cidrBlocks || rule.cidrBlocks.length === 0) {
						continue;
					}
					
					// Check protocol type
					if (protocolType !== "ALL") {
						if (protocolType === "TCP" && rule.protocol !== "tcp") {
							continue;
						}
						if (protocolType === "UDP" && rule.protocol !== "udp") {
							continue;
						}
					}
					
					// Check each CIDR block for global access
					for (const cidrBlock of rule.cidrBlocks) {
						if (isGloballyAccessible(cidrBlock) && shouldCheckIpType(cidrBlock, ipType)) {
							const fromPort = rule.fromPort || 0;
							const toPort = rule.toPort || 65535;
							
							// Check if any restricted port is within the range
							const hasRestrictedPort = restrictPorts.some(port => 
								(fromPort <= port && port <= toPort)
							);
							
							if (hasRestrictedPort) {
								// Build a message that includes which specific restricted ports were found
								const violatingPorts = restrictPorts
									.filter(port => (fromPort <= port && port <= toPort))
									.join(", ");
								
								reportViolation(
									`Security group '${sg.name}' allows unrestricted access from ${cidrBlock} to sensitive port(s): ${violatingPorts}. ` +
									"Exposing these ports to the internet poses a significant security risk. " +
									"Read more here: https://docs.aws.amazon.com/config/latest/developerguide/vpc-sg-port-restriction-check.html"
								);
							}
						}
					}
				}
			}),
		}
	]
});