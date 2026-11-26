import type { ApiKeysConfig, NotificationLogEntry } from '../types/transit';
import { excelService } from './excelService';
import { nativeDeviceService } from './nativeDeviceService';

export interface DispatchNotificationParams {
  eventType: NotificationLogEntry['eventType'];
  recipient: NotificationLogEntry['recipient'];
  recipientLabel: string;
  title: string;
  message: string;
  channel: NotificationLogEntry['channel'];
  apiConfig: ApiKeysConfig;
  phoneNumber?: string;
  rollNumber?: string;
}

function mapEventTypeToCategory(eventType: string): string {
  if (eventType === 'EARLY_UNSCHEDULED_EXIT' || eventType === 'EARLY_EXIT') return 'EARLY_EXIT';
  if (['BREAKDOWN_RESCUE', 'BUS_DELAY_ALERT', 'BREAKDOWN_ALERT', 'DELAY'].includes(eventType)) return 'DELAY';
  if (['OVERSLEEP_EMERGENCY', 'MISSED_STOP', 'EMERGENCY', 'EMERGENCY_BROADCAST'].includes(eventType)) return 'EMERGENCY_BROADCAST';
  if (['BOARDED_CONFIRMED', 'STUDENT_BOARDED'].includes(eventType)) return 'STUDENT_BOARDED';
  return 'DELAY';
}

export async function dispatchSafetyNotification(
  params: DispatchNotificationParams,
): Promise<NotificationLogEntry> {
  const timestamp = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Secure Server-Side Notification Dispatch (eliminates exposed client secrets)
  if (params.channel === 'WHATSAPP_SMS_WEBHOOK') {
    try {
      const response = await fetch(`${excelService.getServerBaseUrl()}/api/notifications/external-dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...excelService.authHeaders(),
        },
        body: JSON.stringify({
          ...(params.rollNumber ? { rollNumber: params.rollNumber } : {}),
          phoneNumber: params.phoneNumber,
          recipientType: params.recipient,
          category: mapEventTypeToCategory(params.eventType),
          title: params.title,
          message: params.message,
        }),
      });

      const resData = await response.json().catch(() => ({}));

      return {
        id,
        timestamp,
        eventType: params.eventType,
        recipient: params.recipient,
        recipientLabel: params.recipientLabel,
        title: params.title,
        message: params.message,
        channel: params.channel,
        deliveryStatus: response.ok && resData.success ? 'DELIVERED_LIVE' : 'FAILED_FALLBACK',
        httpStatusCode: response.status,
      };
    } catch {
      return {
        id,
        timestamp,
        eventType: params.eventType,
        recipient: params.recipient,
        recipientLabel: params.recipientLabel,
        title: params.title,
        message: params.message,
        channel: params.channel,
        deliveryStatus: 'FAILED_FALLBACK',
      };
    }
  }

  if (params.channel === 'FCM_PUSH') {
    try {
      await nativeDeviceService.sendMobileNotification(params.title, params.message);
      return {
        id,
        timestamp,
        eventType: params.eventType,
        recipient: params.recipient,
        recipientLabel: params.recipientLabel,
        title: params.title,
        message: params.message,
        channel: params.channel,
        deliveryStatus: 'DELIVERED_LIVE',
      };
    } catch {
      return {
        id,
        timestamp,
        eventType: params.eventType,
        recipient: params.recipient,
        recipientLabel: params.recipientLabel,
        title: params.title,
        message: params.message,
        channel: params.channel,
        deliveryStatus: 'FAILED_FALLBACK',
      };
    }
  }

  return {
    id,
    timestamp,
    eventType: params.eventType,
    recipient: params.recipient,
    recipientLabel: params.recipientLabel,
    title: params.title,
    message: params.message,
    channel: params.channel,
    deliveryStatus: 'SANDBOX_LOGGED',
  };
}
