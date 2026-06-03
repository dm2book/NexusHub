import jwt from 'jsonwebtoken';
import type { JwtUser } from '@memeforge/shared';
import { env } from '../config/env.js';

export function signAccessToken(user: JwtUser): string {
  return jwt.sign({ email: user.email, role: user.role }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtAccessTtl,
  } as jwt.SignOptions);
}

export function signRefreshToken(user: JwtUser): string {
  return jwt.sign({ typ: 'refresh' }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtRefreshTtl,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtUser & { sub: string } {
  const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  return {
    id: payload.sub as string,
    sub: payload.sub as string,
    email: payload.email as string,
    role: payload.role,
  };
}
