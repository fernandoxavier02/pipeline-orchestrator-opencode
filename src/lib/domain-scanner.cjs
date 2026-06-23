'use strict';

function readOnlyPattern(patterns) {
  const privatePatterns = Object.freeze(patterns.slice());
  return Object.freeze({
    test(value) {
      return privatePatterns.some((pattern) => pattern.test(value));
    },
  });
}

const PATTERNS = Object.freeze({
  auth: readOnlyPattern([
    /(^|[\/\\_.-])(auth|authn|authz|login|logout|session|oauth|openid|saml|sso|jwt|token|password|passwd|credential|permission|identity|identities|rbac)s?([\/\\_.-]|$)/i,
    /(auth|authn|authz|login|logout|session|oauth|openid|saml|sso|jwt|token|password|passwd|credential|permission|identity|identities|rbac)(?=[A-Z]|[\/\\_.-]|$)/,
    /(Auth|Authn|Authz|Login|Logout|Session|OAuth|OpenID|Openid|SAML|Saml|SSO|Sso|JWT|Jwt|Token|Password|Passwd|Credential|Permission|Identity|Identities|RBAC|Rbac)(?=[A-Z]|[\/\\_.-]|$)/,
  ]),
  crypto: readOnlyPattern([
    /(^|[\/\\_.-])(crypto|cipher|encrypt|decrypt|hmac|signature|signer|sign|keypair|privatekey|secret|tls|ssl|x509)s?([\/\\_.-]|$)/i,
    /(crypto|cipher|encrypt|decrypt|hmac|signature|signer|sign|keypair|privateKey|privatekey|secret|tls|ssl|x509)(?=[A-Z]|[\/\\_.-]|$)/,
    /(Crypto|Cipher|Encrypt|Decrypt|HMAC|Hmac|Signature|Signer|Sign|Keypair|KeyPair|PrivateKey|Secret|TLS|Tls|SSL|Ssl|X509)(?=[A-Z]|[\/\\_.-]|$)/,
  ]),
  payment: readOnlyPattern([
    /(^|[\/\\_.-])(payment|billing|charge|invoice|stripe|checkout|refund|payout|subscription|wallet|ledger)s?([\/\\_.-]|$)/i,
    /(payment|billing|charge|invoice|stripe|checkout|refund|payout|subscription|wallet|ledger)(?=[A-Z]|[\/\\_.-]|$)/,
    /(Payment|Billing|Charge|Invoice|Stripe|Checkout|Refund|Payout|Subscription|Wallet|Ledger)(?=[A-Z]|[\/\\_.-]|$)/,
  ]),
  'data-model': readOnlyPattern([
    /(^|[\/\\_.-])(migration|schema|entity|entities|datamodel|repository|repositories|prisma)s?([\/\\_.-]|$)|\.sql$/i,
    /(migration|schema|entity|entities|dataModel|datamodel|repository|repositories|prisma)(?=[A-Z]|[\/\\_.-]|$)/,
    /(Migration|Schema|Entity|Entities|DataModel|Repository|Repositories|Prisma)(?=[A-Z]|[\/\\_.-]|$)/,
  ]),
});

function scanDomains(paths) {
  const out = new Set();
  if (!Array.isArray(paths)) return [];
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || !filePath) continue;
    for (const domain of Object.keys(PATTERNS)) {
      if (PATTERNS[domain].test(filePath)) out.add(domain);
    }
  }
  return [...out].sort();
}

module.exports = { scanDomains, PATTERNS };
