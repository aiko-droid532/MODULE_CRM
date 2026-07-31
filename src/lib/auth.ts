import * as jose from 'jose';

// 1. Секрет для ERP (HS256)
const JWT_SECRET = process.env.JWT_SECRET;
const encodedSecret = JWT_SECRET ? new TextEncoder().encode(JWT_SECRET) : null;

// Кешируем JWK ключ локально для мгновенной верификации за 0.1мс без сетевых запросов
const JWK_LOCAL = {
  alg: "ES256",
  crv: "P-256",
  ext: true,
  key_ops: ["verify"],
  kid: "d1237089-cb65-482d-a64d-498613321cb5",
  kty: "EC",
  use: "sig",
  x: "D6jlKHP5c75YItS0mq3ol8y9W9mgOW3Jlda1J_328Fs",
  y: "4MDBVF8DxYARQ05yDet0b_mxgtEbKs6fFhuiAP8Mdn4"
};

let cachedKey: any = null;

async function getLocalKey() {
  if (!cachedKey) {
    cachedKey = await jose.importJWK(JWK_LOCAL, 'ES256');
  }
  return cachedKey;
}

// Резервный удаленный JWKS на случай ротации ключей
const REMOTE_JWKS = jose.createRemoteJWKSet(
  new URL('https://nepapflngrjqjhczrvsc.supabase.co/auth/v1/.well-known/jwks.json')
);

export async function verifyToken(token: string) {
  // 1. Сначала пробуем проверить локально по HS256 с использованием JWT_SECRET (ERP) — это мгновенно!
  if (encodedSecret) {
    try {
      const { payload } = await jose.jwtVerify(token, encodedSecret);
      return { payload };
    } catch (hsErr) {
      // Игнорируем и идем дальше, если токен не HS256
    }
  }

  try {
    // 2. Пытаемся проверить локально по ES256 (0.1 мс!)
    const localKey = await getLocalKey();
    const { payload } = await jose.jwtVerify(token, localKey);
    return { payload };
  } catch (localErr) {
    // 3. Если локальные ключи не подошли, делаем запрос к Supabase
    try {
      const { payload } = await jose.jwtVerify(token, REMOTE_JWKS);
      return { payload };
    } catch (remoteErr: any) {
      console.error('JWT verification failed (all methods):', remoteErr);
      return { error: remoteErr.message || String(remoteErr) };
    }
  }
}