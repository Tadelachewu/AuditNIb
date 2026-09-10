
# 🔍 NibBot Chatbot Vulnerability Assessment (VA) Report Analysis

## Overview
This document contains the analysis of the `ChatBot VA report.docx` vulnerability assessment findings for the NibBot application, with severity ratings from High to Low.

## Vulnerability Summary by Severity

| Severity | Count | Vulnerabilities |
|----------|-------|-----------------|
| **High** | 5 | VA-001, VA-002, VA-003, VA-004, VA-005 |
| **Medium** | 5 | VA-006, VA-008, VA-009, VA-010, VA-011 |
| **Low** | 3 | VA-012, VA-013, VA-014 |

---

## Detailed Vulnerability Analysis

### High Severity Findings

#### VA-001: Use of Vulnerable Third-Party Component (esbuild)
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-001 |
| **Severity** | High |
| **CVSS v3.1** | 8.1 (High) |
| **Assessment Type** | SCA (Software Composition Analysis) |
| **Affected Asset** | esbuild npm package (0.17.0 – 0.28.0) |
| **Description** | Vulnerable to: <br>1. Missing binary integrity verification in Deno module → potential RCE <br>2. Arbitrary file read on Windows dev servers |
| **Current Installed Version** | **0.28.0 (Confirmed in package-lock.json)** |
| **Impact** | Arbitrary code execution, unauthorized file read, supply-chain attacks |
| **Recommendation** | Upgrade esbuild to latest secure version (latest as of June 2026 is **0.28.1 or higher**); implement SCA in CI/CD; regularly update dependencies |
| **Fix Steps** |
1. Check the latest esbuild version at [npmjs.com/package/esbuild](https://npmjs.com/package/esbuild)
2. Upgrade esbuild via npm/yarn: it's a transitive dependency via Next.js, so add an override in `package.json`:
3. Verify fix:
```json
"overrides": {
  "esbuild": "^0.28.1"
}
```
4. Run `npm install` or yarn install` to apply the override
5. Verify installed version with `npm ls esbuild`

---

#### VA-002: Server-Side Request Forgery (SSRF)
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-002 |
| **Severity** | High |
| **CVSS v3.1** | 8.1 (High) |
| **Assessment Type** | SAST (Static Application Security Testing) |
| **Affected Asset** | `src/app/api/proxy/route.ts` |
| **CWE** | CWE-918: Server-Side Request Forgery (SSRF) |
| **Description** | Proxy endpoint accepts any user-supplied URL starting with `http`/`https` with no further validation |
| **Evidence** |
```typescript
const { url } = body;
if (!url.startsWith('http')) {
    return error;
}
const response = await fetch(url, fetchOptions);
```
| **Impact** | Access internal services, sensitive info exposure, network reconnaissance, bypass access restrictions |
| **Recommendation** | Implement strict domain allowlist; block localhost/private IPs/cloud metadata; validate/normalize URLs; monitor outbound requests |

---

#### VA-003: Vulnerable form-data Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-003 |
| **Severity** | High |
| **CVSS v3.1** | 7.5 (High) |
| **Assessment Type** | SCA |
| **Affected Asset** | form-data npm package (4.0.0–4.0.5) |
| **CWE** | CWE-93: Improper Neutralization of CRLF Sequences |
| **Description** | Vulnerable to CRLF injection via multipart field names/filenames |
| **Impact** | Request tampering, unexpected app behavior |
| **Recommendation** | Upgrade form-data to 4.0.6 or later |

---

#### VA-004: Vulnerable hono Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-004 |
| **Severity** | High |
| **CVSS v3.1** | 8.1 (High) |
| **Assessment Type** | SCA |
| **Affected Asset** | hono npm package (≤ 4.12.24) |
| **CWE** | CWE-22: Path Traversal |
| **Description** | Vulnerable to path traversal, improper CORS, request processing issues, AWS adapter bugs |
| **Impact** | Bypass security controls, access unintended resources, disrupt availability |
| **Recommendation** | Upgrade hono to &gt;4.12.24; review middleware/adapter usage |

---

#### VA-005: Vulnerable ws Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-005 |
| **Severity** | High |
| **CVSS v3.1** | 7.5 (High) |
| **Assessment Type** | SCA |
| **Affected Asset** | ws npm package (8.0.0–8.20.1) |
| **CWE** | CWE-400: Uncontrolled Resource Consumption |
| **Description** | Vulnerable to memory exhaustion via specially crafted fragmented WebSocket messages |
| **Current Installed Version** | 8.21.0 (Confirmed via `npm ls ws`) |
| **Impact** | Denial of Service (DoS), reduced availability |
| **Recommendation** | Upgrade ws to 8.20.2 or later; implement WebSocket connection/message size limits |
| **Fix Applied**: 
1. **Package Override**: Added `"ws": "^8.21.0"` to `package.json` overrides (8.21.0 &gt; 8.20.2, fixed)
2. **Server Configuration** in `server.js`:
   - Added `maxHttpBufferSize: 1e6` (1MB) maximum message size limit
   - Added per-IP WebSocket connection limit (MAX 20 concurrent connections per IP)
   - Added ping timeout (20s) and ping interval (25s)
   - Added connection count cleanup on socket disconnect

---

### Medium Severity Findings

#### VA-006: Weak Password Policy Enforcement
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-006 |
| **Severity** | Medium |
| **CVSS v3.1** | 5.3 (Medium) |
| **Assessment Type** | DAST (Dynamic Application Security Testing) |
| **Affected Asset** | Authentication Module / Password Policy |
| **CWE** | CWE-521: Weak Password Requirements |
| **Description** | Doesn't enforce strong passwords; accepts breached passwords |
| **Impact** | Credential stuffing, password guessing attacks |
| **Recommendation** | Implement strong password policy; block known breached passwords |
| **Fix Applied**:
1. **Shared Password Validation Lib**: Created `src/lib/passwordValidation.ts` with:
   - Strong password requirements (8+ chars, uppercase, lowercase, number, special character)
   - Common password blocklist (~100 most common breached passwords)
   - Optional Have I Been Pwned (HIBP) k-Anonymity API integration (for full breach checking)
2. **Enforced in all password set/change endpoints**:
   - Change password (`src/app/api/admin/auth/change-password/route.ts`)
   - Reset password (`src/app/api/admin/auth/reset/route.ts`)
   - Admin sets user password (`src/app/api/admin/users/route.ts`)
   - Seed script (`prisma/seed.ts`)
3. **Client-side pre-validation**: Added to improve UX in change password page
4. **Defense-in-depth**: Server-side validation (required) plus client-side checks (optional UX)
5. **Optional HIBP Integration**: To enable full breach checking, add `await isPasswordBreached(password)` check in server-side endpoints (see lib for implementation)
6. **Password Strength Evaluator**: Maintained `evaluatePasswordStrength` and `isStrongPassword` functions

| Updated File | Change |
|--------------|--------|
| `src/lib/passwordValidation.ts` | Created new shared validation library |
| `src/components/admin/AdminAuthContext.tsx` | Updated import to use shared lib |
| `src/app/admin/change-password/page.tsx` | Updated import to use shared lib |
| `src/app/api/admin/auth/change-password/route.ts` | Added server-side validation |
| `src/app/api/admin/auth/reset/route.ts` | Added server-side validation |
| `src/app/api/admin/users/route.ts` | Added server-side validation |
| `prisma/seed.ts` | Added validation for initial admin/checker users |

---

#### VA-008: Process-Wide TLS Certificate Verification Disabled
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-008 |
| **Severity** | Medium |
| **CVSS v3.1** | 5.9 (Medium) |
| **Assessment Type** | SAST |
| **Affected Asset** | `src/app/api/proxy/route.ts` |
| **CWE** | CWE-295: Improper Certificate Validation |
| **Description** | If `ALLOW_SELF_SIGNED_CERTS=true`, it disables TLS validation **process-wide**:
```typescript
if (process.env.ALLOW_SELF_SIGNED_CERTS === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
```
| **Impact** | MITM attacks, encrypted comms interception, impersonation of trusted services |
| **Recommendation** | Remove process-wide override; use scoped HTTPS agents for dev/test; block insecure configs in production |

---

#### VA-009: Vulnerable DOMPurify Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-009 |
| **Severity** | Medium |
| **CVSS v3.1** | 6.1 (Medium) |
| **Assessment Type** | SCA |
| **Affected Asset** | DOMPurify npm package (&lt;3.4.9) |
| **CWE** | CWE-79: Cross-Site Scripting (XSS) |
| **Description** | Vulnerable to Trusted Types policy persistence |
| **Impact** | Increased XSS risk |
| **Recommendation** | Upgrade DOMPurify to ≥3.4.9 |

---

#### VA-010: Vulnerable js-yaml Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-010 |
| **Severity** | Medium |
| **CVSS v3.1** | 5.3 (Medium) |
| **Assessment Type** | SCA |
| **Affected Asset** | js-yaml npm package (≤4.1.1) |
| **CWE** | CWE-400: Uncontrolled Resource Consumption |
| **Description** | DoS via excessive resource consumption from YAML with repeated aliases |
| **Impact** | Service degradation/DoS |
| **Recommendation** | Upgrade js-yaml to &gt;4.1.1 |

---

#### VA-011: Vulnerable protobufjs Dependency
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-011 |
| **Severity** | Medium |
| **CVSS v3.1** | 5.4 (Medium) |
| **Assessment Type** | SCA |
| **Affected Asset** | protobufjs npm package (≤7.6.2) |
| **CWE** | CWE-915: Improperly Controlled Modification of Dynamically Determined Object Attributes |
| **Description** | Schema-derived names can shadow runtime-significant properties |
| **Impact** | Unexpected behavior, integrity issues |
| **Recommendation** | Upgrade protobufjs to &gt;7.6.2 |

---

### Low Severity Findings

#### VA-012: Server Tech Info Disclosure via X-Powered-By Header
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-012 |
| **Severity** | Low |
| **Assessment Type** | DAST |
| **Affected Asset** | `https://nibterachatboat.nibbank.com.et/admin` |
| **CWE** | CWE-200: Exposure of Sensitive Information |
| **Description** | Returns `X-Powered-By: ARR/3.0` header disclosing tech stack |
| **Impact** | Assists attackers in environment fingerprinting |
| **Recommendation** | Remove/suppress `X-Powered-By`, `Server`, `X-AspNet-Version` headers |

---

#### VA-013: Insufficient File Type Validation
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-013 |
| **Severity** | Low |
| **CVSS v3.1** | 3.7 (Medium) |
| **Assessment Type** | DAST |
| **Affected Asset** | `https://nibterachatboat.nibbank.com.et/admin` |
| **CWE** | CWE-434, CWE-20 |
| **Description** | Image upload accepts non-image files (HTML, PDF, Excel) with only client-side validation |
| **Impact** | Storage of unauthorized content, malicious files, client-side attacks, storage abuse |
| **Recommendation** | Strict server-side allowlist validation; check file extensions, MIME types, and magic bytes |

---

#### VA-014: Internal App Data in Browser Local Storage
| Field | Detail |
|-------|--------|
| **Finding ID** | VA-014 |
| **Severity** | Low |
| **CVSS v3.1** | 3.7 (Low) |
| **Assessment Type** | DAST |
| **Affected Asset** | `nibterachatboat.nibbank.com.et` |
| **Description** | Stores internal workflow data, session IDs, draft info in Local Storage (accessible to XSS) |
| **Impact** | Info exposure if XSS/compromise; increased attack surface |
| **Recommendation** | Avoid storing internal data in Local Storage; enforce server-side validation; implement CSP |

---

## Key Recommendations

### Immediate Actions (High Priority)
1. **Upgrade dependencies**: esbuild, form-data, hono, ws
2. **Fix SSRF**: Implement domain allowlist in `src/app/api/proxy/route.ts`; block private IPs/localhost
3. **Remove TLS override**: Remove process-wide `NODE_TLS_REJECT_UNAUTHORIZED` override

### Short-Term Actions (Medium Priority)
1. **Upgrade remaining dependencies**: DOMPurify, js-yaml, protobufjs
2. **Implement strong password policy**: Block breached passwords
3. **Fix file upload validation**: Strict server-side allowlist + magic byte checks

### Long-Term Actions (Low Priority)
1. **Remove tech disclosure headers**: `X-Powered-By`, etc.
2. **Clean up Local Storage usage**: Minimize data stored client-side
3. **Implement CI/CD SCA**: Continuously monitor dependencies for vulnerabilities

---

## Correlated Code Files
| Finding | Code File |
|---------|-----------|
| VA-002, VA-008 | `src/app/api/proxy/route.ts` |
| VA-013 (file uploads) | Likely `src/components/admin/MenuManagement.tsx` |
| VA-006 (passwords) | Likely `src/lib/auth.ts` and auth API routes |

