export type AlertSeverity = 'informational' | 'attention' | 'high' | 'critical';
export type DeviceStatus = 'online' | 'offline' | 'degraded' | 'maintenance';
export type DeviceType = 'camera' | 'sensor' | 'gateway' | 'nvr' | 'gps' | 'siren' | 'panic';

export type AppRole =
  | 'admin_ifarm'
  | 'admin_organization'
  | 'admin_neighborhood'
  | 'owner'
  | 'family'
  | 'employee'
  | 'technician'
  | 'monitoring'
  | 'authorized_authority'
  | 'insurance_partner';

export type Permission =
  | 'tenant:admin'
  | 'community:manage'
  | 'property:view'
  | 'private_device:view'
  | 'community_device:view'
  | 'event:view'
  | 'incident:view'
  | 'asset:view'
  | 'insurance:view'
  | 'technical:maintain';

export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  admin_ifarm: ['tenant:admin','community:manage','property:view','private_device:view','community_device:view','event:view','incident:view','asset:view','insurance:view','technical:maintain'],
  admin_organization: ['tenant:admin','community:manage','property:view','private_device:view','community_device:view','event:view','incident:view','asset:view','insurance:view','technical:maintain'],
  admin_neighborhood: ['community:manage','community_device:view','event:view','incident:view'],
  owner: ['property:view','private_device:view','community_device:view','event:view','incident:view','asset:view','insurance:view'],
  family: ['property:view','private_device:view','community_device:view','event:view','incident:view'],
  employee: ['property:view','private_device:view','event:view'],
  technician: ['technical:maintain'],
  monitoring: ['community_device:view','event:view','incident:view'],
  authorized_authority: ['community_device:view','event:view','incident:view'],
  insurance_partner: ['insurance:view']
};

export interface TenantContext {
  organizationId: string;
  neighborhoodId?: string;
  propertyId?: string;
  userId: string;
  role?: AppRole;
}

export interface SecurityEvent {
  id: string;
  organizationId: string;
  propertyId?: string;
  deviceId: string;
  type: string;
  severity: AlertSeverity;
  confidence?: number;
  occurredAt: string;
  requiresHumanValidation: boolean;
}
