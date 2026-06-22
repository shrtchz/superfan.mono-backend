export enum TaskPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export enum ActivityType {
  user_registered = 'user_registered',
  content_approved = 'content_approved',
  report_submitted = 'report_submitted',
  subadmin_registered = 'subadmin_registered',
}

export enum EarningStatus {
  PENDING = 'PENDING',
  AVAILABLE = 'AVAILABLE',
  PAID_OUT = 'PAID_OUT',
}