import { describe, expect, it } from 'vitest'

import { generateTypeFromSchema } from './generate-types'

describe('generateTypeFromSchema', () => {
  it('should generate a type from a schema using module.Import', () => {
    const result = generateTypeFromSchema(
      '@/schemas/v3.1/strict/openapi-document.ts',
      new Map([['ContactObjectSchema', 'ContactObject']]),
    )
    expect(result).toBe(
      `/** Contact information for the exposed API. */
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string
  /** The URI for the contact information. This MUST be in the form of a URI. */
  url?: string
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string
}`,
    )
  })

  it('should generate two types from two unrelated schmeas', () => {
    const result = generateTypeFromSchema(
      '@/schemas/v3.1/strict/openapi-document.ts',
      new Map([
        ['ContactObjectSchema', 'ContactObject'],
        ['LicenseObjectSchema', 'LicenseObject'],
      ]),
    )
    expect(result).toBe(
      `/** Contact information for the exposed API. */
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string
  /** The URI for the contact information. This MUST be in the form of a URI. */
  url?: string
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string
}
/** The license information for the exposed API. */
export type LicenseObject = {
  /** REQUIRED. The license name used for the API. */
  name?: string
  /** An SPDX license expression for the API. The identifier field is mutually exclusive of the url field. */
  identifier?: string
  /** A URI for the license used for the API. This MUST be in the form of a URI. The url field is mutually exclusive of the identifier field. */
  url?: string
}`,
    )
  })

  it('should generates three schemas which have interdependencies', () => {
    const result = generateTypeFromSchema(
      '@/schemas/v3.1/strict/openapi-document.ts',
      new Map([
        ['ContactObjectSchema', 'ContactObject'],
        ['LicenseObjectSchema', 'LicenseObject'],
        ['InfoObjectSchema', 'InfoObject'],
      ]),
    )
    expect(result).toBe(
      `/** Contact information for the exposed API. */
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string
  /** The URI for the contact information. This MUST be in the form of a URI. */
  url?: string
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string
}
/** The license information for the exposed API. */
export type LicenseObject = {
  /** REQUIRED. The license name used for the API. */
  name?: string
  /** An SPDX license expression for the API. The identifier field is mutually exclusive of the url field. */
  identifier?: string
  /** A URI for the license used for the API. This MUST be in the form of a URI. The url field is mutually exclusive of the identifier field. */
  url?: string
}
/** The object provides metadata about the API. The metadata MAY be used by the clients if needed, and MAY be presented in editing or documentation generation tools for convenience. */  
export type InfoObject = {
  /** REQUIRED. The title of the API. */
  title: string
  /** A short summary of the API. */
  summary?: string
  /** A description of the API. CommonMark syntax MAY be used for rich text representation. */
  description?: string
  /** A URI for the Terms of Service for the API. This MUST be in the form of a URI. */
  termsOfService?: string
  /** The contact information for the exposed API. */
  contact?: ContactObject
  /** The license information for the exposed API. */
  license?: LicenseObject
  /** REQUIRED. The version of the OpenAPI Document (which is distinct from the OpenAPI Specification version or the version of the API being described or the version of the OpenAPI Description). */
  version: string
  /** Allow custom SDK installation instructions to be added to the API documentation. */
  'x-scalar-sdk-installation'?: {
    lang: string
    source?: string
    description?: string
  }[]
}`,
    )
  })
})
