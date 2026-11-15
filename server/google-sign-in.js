import {createRemoteJWKSet, jwtVerify} from 'jose';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const issuer = ['https://accounts.google.com', 'accounts.google.com'];

export function googleClientId(env = {}) {
  const id = env.GOOGLE_CLIENT_ID?.trim();
  return /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(id || '') ? id : null;
}

export async function verifyGoogleCredential(credential, clientId, keys = googleKeys) {
  const {payload} = await jwtVerify(credential, keys, {
    algorithms:['RS256'],
    audience:clientId,
    issuer,
    requiredClaims:['exp','iat','nonce','sub'],
    maxTokenAge:'10 minutes',
    clockTolerance:10
  });
  if (typeof payload.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(payload.sub) ||
      typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(payload.nonce) ||
      (payload.azp && payload.azp !== clientId)) throw new Error('Invalid Google credential');
  return {subject:payload.sub, nonce:payload.nonce};
}
