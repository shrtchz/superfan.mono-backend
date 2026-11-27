import { verifyToken } from '@clerk/backend';
import { Socket } from 'socket.io';
import { prisma } from '../../prisma/prisma';

export interface AuthenticatedSocketUser {
  id: number;
  roleName: string;
}

function extractBearerToken(value?: string): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return trimmed;
}

function extractSessionCookie(cookieHeader?: string): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === '__session' && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export function extractSocketToken(client: Socket): string | null {
  const authToken = extractBearerToken(
    typeof client.handshake?.auth?.token === 'string'
      ? client.handshake.auth.token
      : undefined,
  );
  if (authToken) return authToken;

  const headerToken = extractBearerToken(
    typeof client.handshake?.headers?.authorization === 'string'
      ? client.handshake.headers.authorization
      : undefined,
  );
  if (headerToken) return headerToken;

  const cookieToken = extractSessionCookie(
    typeof client.handshake?.headers?.cookie === 'string'
      ? client.handshake.headers.cookie
      : undefined,
  );
  if (cookieToken) return cookieToken;

  return extractBearerToken(
    typeof client.handshake?.query?.token === 'string'
      ? client.handshake.query.token
      : undefined,
  );
}

export async function authenticateSocketClient(
  client: Socket,
): Promise<AuthenticatedSocketUser | null> {
  const token = extractSocketToken(client);
  if (
    !token ||
    token === 'undefined' ||
    token === 'null' ||
    token.startsWith('sit_') ||
    token.startsWith('sint_')
  ) {
    return null;
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      clockSkewInMs: 300000,
    });

    let user = await prisma.user.findUnique({
      where: { clerkUserId: payload.sub },
      select: { id: true, roleName: true },
    });

    if (!user && typeof payload.email === 'string') {
      user = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { id: true, roleName: true },
      });
    }

    if (!user) return null;

    client.data.userId = user.id;
    client.data.roleName = user.roleName;
    return user;
  } catch {
    return null;
  }
}
