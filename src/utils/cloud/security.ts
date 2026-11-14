import 'server-only'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Separate review gates. Neither environment variables nor tenant settings can
// authorize provider calls or use an unapplied schema in this release.
export const CLOUD_INSTALLATION_APPROVED = false as const
export const CLOUD_PROVIDER_RELEASE_APPROVED = false as const
export function requireCloudInstallation() {
  if (!CLOUD_INSTALLATION_APPROVED) throw new Error('Cloud runtime awaiting reviewed database installation')
}
export function requireProviderRelease() {
  if (!CLOUD_PROVIDER_RELEASE_APPROVED) throw new Error('Live provider operations awaiting explicit approval')
}
export type CredentialBinding = { workspaceId: string; channelId: string }
export type SealedToken = { version: 1; keyId: string; iv: string; ciphertext: string; tag: string }
const identity = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function aad(binding: CredentialBinding, keyId: string) {
  if (!identity.test(binding.workspaceId) || !identity.test(binding.channelId) || !/^[a-z0-9_-]{1,40}$/.test(keyId)) throw Error('Invalid credential binding')
  return Buffer.from(JSON.stringify(['wasla-meta-token',1,binding.workspaceId.toLowerCase(),binding.channelId.toLowerCase(),keyId]))
}
function key(keys: Readonly<Record<string,string>>, id: string) {
  const encoded = keys[id]
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw Error('Credential key unavailable')
  const bytes = Buffer.from(encoded,'base64')
  if (bytes.length !== 32) throw Error('Credential key unavailable')
  return bytes
}
export function sealToken(token: string, binding: CredentialBinding, keyId: string, keys: Readonly<Record<string,string>>): SealedToken {
  if (!token || token.length > 8192 || /[\s\u0000-\u001f]/.test(token)) throw Error('Invalid provider token')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(keys,keyId),iv)
  cipher.setAAD(aad(binding,keyId))
  const ciphertext = Buffer.concat([cipher.update(token,'utf8'),cipher.final()])
  return {version:1,keyId,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')}
}
export function openToken(sealed: SealedToken, binding: CredentialBinding, keys: Readonly<Record<string,string>>) {
  try {
    if (sealed.version !== 1 || Buffer.from(sealed.iv,'base64').length !== 12 || Buffer.from(sealed.tag,'base64').length !== 16 || sealed.ciphertext.length > 12000) throw Error()
    const decipher = createDecipheriv('aes-256-gcm',key(keys,sealed.keyId),Buffer.from(sealed.iv,'base64'))
    decipher.setAAD(aad(binding,sealed.keyId));decipher.setAuthTag(Buffer.from(sealed.tag,'base64'))
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext,'base64')),decipher.final()]).toString('utf8')
  } catch { throw Error('Credential unavailable') }
}
export function rotateToken(sealed: SealedToken, binding: CredentialBinding, nextKey: string, keys: Readonly<Record<string,string>>) {
  return sealToken(openToken(sealed,binding,keys),binding,nextKey,keys)
}
export const appSecretProof = (token: string, secret: string) => createHmac('sha256',secret).update(token).digest('hex')
export function equalSecret(provided: string | null, expected: string | undefined) {
  if (!provided || !expected || expected.length<32 || provided.length > 4096) return false
  return timingSafeEqual(createHmac('sha256','wasla-job').update(provided).digest(),createHmac('sha256','wasla-job').update(expected).digest())
}
