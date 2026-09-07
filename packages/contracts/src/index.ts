export type AlertSeverity = 'informational' | 'attention' | 'high' | 'critical';
export type DeviceStatus = 'online' | 'offline' | 'degraded' | 'maintenance';
export type DeviceType = 'camera' | 'sensor' | 'gateway' | 'nvr' | 'gps' | 'siren' | 'panic';

export interface TenantContext {
  organizationId: string;
  neighborhoodId?: string;
  propertyId?: string;
  userId: string;
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
